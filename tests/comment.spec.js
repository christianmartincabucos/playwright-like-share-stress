const { test } = require('@playwright/test');
const path = require('node:path');
const config = require('../stress.config');
const { createCommentRunState } = require('../src/state');
const { StabilityMonitor } = require('../src/monitor');
const { inspectPage } = require('../src/inspect');
const { ensureDirectories, writeJson } = require('../src/helpers');
const { runCommentStress } = require('../src/runner');
const { finalizeCommentReport } = require('../src/report');
const { logRun, logAction } = require('../src/logger');

test('sequential Comment stability stress test', async ({ page, context }) => {
  const state = createCommentRunState(config);
  const monitor = new StabilityMonitor(page, context, state, config.targetUrl, config);
  await ensureDirectories(config);

  monitor.attach();
  const startedAtMs = Date.now();
  logRun(`Target: ${config.targetUrl}`);
  logRun(`Planned interactions: Comment=${config.commentClicks}`);
  logRun(`Pacing: ${config.delayBetweenClicksMs} ms between clicks; batch size=${config.batchSize}; batch cooldown=${config.batchCooldownMs} ms`);

  try {
    state.navigation.attempted = true;
    const response = await page.goto(config.targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: config.navigationTimeoutMs
    });
    state.navigation.status = response ? response.status() : null;
    if (response && response.status() >= 400) {
      throw new Error(`Navigation returned HTTP ${response.status()}.`);
    }
    await page.waitForLoadState('load', { timeout: config.navigationTimeoutMs }).catch(() => {});
    state.navigation.succeeded = true;

    state.inspection = await inspectPage(page);
    await writeJson(path.join(config.reportsDir, 'preflight-comment.json'), state.inspection);
    logRun(`Page ready: ${state.inspection.title || page.url()}`);
    logRun(`Detected Comment: ${state.inspection.comment.disposition.runnable ? state.inspection.comment.disposition.mode || 'available' : 'unavailable'}`);

    if (monitor.shouldStop()) throw new Error(monitor.fatalReason);

    if (state.inspection.comment.disposition.runnable) {
      await runCommentStress(page, config, state, monitor);
    } else {
      state.actions.comment.status = 'skipped';
      state.actions.comment.skipped = state.actions.comment.requested;
      state.notes.push(`Comment skipped: ${state.inspection.comment.disposition.reason}`);
      logAction(state, 'comment', 'SKIPPED', null, state.actions.comment.requested, { reason: state.inspection.comment.disposition.reason });
    }
  } catch (error) {
    state.navigation.error = state.navigation.succeeded ? null : error.message;
    state.stopReason = state.stopReason || error.message;
    if (!state.errors.some(item => item.message === error.message)) {
      state.errors.push({
        timestamp: new Date().toISOString(),
        iteration: null,
        action: 'setup',
        message: error.message,
        url: (() => { try { return page.url(); } catch (_) { return null; } })(),
        screenshot: null
      });
    }
  } finally {
    const action = state.actions.comment;
    if (action.status === 'not_started' && action.requested > 0) {
      action.status = 'not_run';
      action.skipped = action.requested;
    }
    state.executionTimeMs = Date.now() - startedAtMs;
    await finalizeCommentReport(state, config);
    logRun(`FINAL STATUS: ${state.finalStatus}`);
    logRun(`COMMENT totals: ${state.actions.comment.successful}/${state.actions.comment.requested} successful, ${state.actions.comment.failed} failed, ${state.actions.comment.skipped} skipped`);
    logRun(`Detailed activity: ${path.join(config.reportsDir, 'activity.log')}`);
    logRun(`Summary report: ${path.join(config.reportsDir, 'summary-comment.md')}`);
    if (state.finalStatus === 'Failed') throw new Error(`Comment stress test failed. See ${path.join(config.reportsDir, 'summary-comment.md')}`);
  }
});
