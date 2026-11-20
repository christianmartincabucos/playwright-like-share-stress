const { test } = require('@playwright/test');
const path = require('node:path');
const config = require('../stress.config');
const { createLikeRunState } = require('../src/state');
const { StabilityMonitor } = require('../src/monitor');
const { inspectPage } = require('../src/inspect');
const { ensureDirectories, writeJson } = require('../src/helpers');
const { runLikeStress } = require('../src/runner');
const { finalizeLikeReport } = require('../src/report');
const { logRun, logAction } = require('../src/logger');

test('sequential Like stability stress test', async ({ page, context }) => {
  const state = createLikeRunState(config);
  const monitor = new StabilityMonitor(page, context, state, config.targetUrl, config);
  await ensureDirectories(config);

  monitor.attach();
  const startedAtMs = Date.now();
  logRun(`Target: ${config.targetUrl}`);
  logRun(`Planned interactions: Like=${config.likeClicks}`);
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
    await writeJson(path.join(config.reportsDir, 'preflight-like.json'), state.inspection);
    logRun(`Page ready: ${state.inspection.title || page.url()}`);
    logRun(`Detected Like: ${state.inspection.like.disposition.mode || (state.inspection.like.disposition.runnable ? 'available' : 'unavailable')}`);

    if (monitor.shouldStop()) throw new Error(monitor.fatalReason);

    if (state.inspection.like.disposition.runnable) {
      await runLikeStress(page, config, state, monitor);
    } else {
      state.actions.like.status = 'skipped';
      state.actions.like.skipped = state.actions.like.requested;
      state.notes.push(`Like skipped: ${state.inspection.like.disposition.reason}`);
      logAction(state, 'like', 'SKIPPED', null, state.actions.like.requested, { reason: state.inspection.like.disposition.reason });
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
    const action = state.actions.like;
    if (action.status === 'not_started' && action.requested > 0) {
      action.status = 'not_run';
      action.skipped = action.requested;
    }
    state.executionTimeMs = Date.now() - startedAtMs;
    await finalizeLikeReport(state, config);
    logRun(`FINAL STATUS: ${state.finalStatus}`);
    logRun(`LIKE totals: ${state.actions.like.successful}/${state.actions.like.requested} successful, ${state.actions.like.failed} failed, ${state.actions.like.skipped} skipped`);
    logRun(`Detailed activity: ${path.join(config.reportsDir, 'activity.log')}`);
    logRun(`Summary report: ${path.join(config.reportsDir, 'summary-like.md')}`);
    if (state.finalStatus === 'Failed') throw new Error(`Like stress test failed. See ${path.join(config.reportsDir, 'summary-like.md')}`);
  }
});
