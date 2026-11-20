const { test } = require('@playwright/test');
const path = require('node:path');
const config = require('../stress.config');
const { createRunState } = require('../src/state');
const { StabilityMonitor } = require('../src/monitor');
const { inspectPage } = require('../src/inspect');
const { ensureDirectories, writeJson } = require('../src/helpers');
const { runLikeStress, runShareStress } = require('../src/runner');
const { finalizeReport } = require('../src/report');
const { logRun, logAction } = require('../src/logger');

test('sequential Like and Share stability stress test', async ({ page, context }) => {
  const state = createRunState(config);
  const monitor = new StabilityMonitor(page, context, state, config.targetUrl, config);
  await ensureDirectories(config);

  // Prevent real-world side effects while still exercising the application's Share click handler.
  await context.addInitScript(() => {
    Object.defineProperty(window, '__qaShareMetrics', {
      configurable: false,
      writable: false,
      value: { shareCalls: 0, clipboardWrites: 0, openCalls: 0 }
    });

    try {
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async () => { window.__qaShareMetrics.shareCalls += 1; }
      });
      Object.defineProperty(navigator, 'canShare', {
        configurable: true,
        value: () => true
      });
    } catch (_) { /* Share API may be non-configurable in a browser build. */ }

    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async () => { window.__qaShareMetrics.clipboardWrites += 1; },
          readText: async () => ''
        }
      });
    } catch (_) { /* Clipboard may be non-configurable in a browser build. */ }

    try {
      const nativeOpen = window.open.bind(window);
      window.open = (...args) => {
        window.__qaShareMetrics.openCalls += 1;
        // Preserve normal browser behavior: the runner will observe and close
        // any destination popup after confirming where it navigated.
        return nativeOpen(...args);
      };
    } catch (_) { /* The browser may disallow wrapping window.open. */ }
  });

  monitor.attach();
  const startedAtMs = Date.now();
  logRun(`Target: ${config.targetUrl}`);
  logRun(`Planned interactions: Like=${config.likeClicks}, Share=${config.shareClicks}`);
  logRun(`Pacing: ${config.delayBetweenClicksMs} ms between clicks; batch size=${config.batchSize}; batch cooldown=${config.batchCooldownMs} ms`);

  // External destination tabs are intentionally allowed. Like/Share handlers
  // close those tabs or use browser Back to restore the dashboard.

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
    await page.waitForLoadState('load', { timeout: config.navigationTimeoutMs }).catch(() => { });
    state.navigation.succeeded = true;

    state.inspection = await inspectPage(page);
    await writeJson(path.join(config.reportsDir, 'preflight.json'), state.inspection);
    logRun(`Page ready: ${state.inspection.title || page.url()}`);
    logRun(`Detected Like: ${state.inspection.like.disposition.mode || 'unavailable'}; Share: ${state.inspection.share.disposition.runnable ? 'available' : 'unavailable'}`);

    if (monitor.shouldStop()) throw new Error(monitor.fatalReason);

    if (state.inspection.like.disposition.runnable) {
      await runLikeStress(page, config, state, monitor);
    } else {
      state.actions.like.status = 'skipped';
      state.actions.like.skipped = state.actions.like.requested;
      state.notes.push(`Like skipped: ${state.inspection.like.disposition.reason}`);
      logAction(state, 'like', 'SKIPPED', null, state.actions.like.requested, { reason: state.inspection.like.disposition.reason });
    }

    // Still exercise Share if Like was safely skipped, unless the browser/server is unhealthy.
    if (!monitor.shouldStop() && state.inspection.share.disposition.runnable) {
      await runShareStress(page, context, config, state, monitor);
    } else if (!state.inspection.share.disposition.runnable) {
      state.actions.share.status = 'skipped';
      state.actions.share.skipped = state.actions.share.requested;
      state.notes.push(`Share skipped: ${state.inspection.share.disposition.reason}`);
      logAction(state, 'share', 'SKIPPED', null, state.actions.share.requested, { reason: state.inspection.share.disposition.reason });
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
    for (const key of ['like', 'share']) {
      const action = state.actions[key];
      if (action.status === 'not_started' && action.requested > 0) {
        action.status = 'not_run';
        action.skipped = action.requested;
      }
    }
    state.executionTimeMs = Date.now() - startedAtMs;
    await finalizeReport(state, config);
    logRun(`FINAL STATUS: ${state.finalStatus}`);
    logRun(`LIKE totals: ${state.actions.like.successful}/${state.actions.like.requested} successful, ${state.actions.like.failed} failed, ${state.actions.like.skipped} skipped`);
    logRun(`SHARE totals: ${state.actions.share.successful}/${state.actions.share.requested} successful, ${state.actions.share.failed} failed, ${state.actions.share.skipped} skipped`);
    logRun(`Detailed activity: ${path.join(config.reportsDir, 'activity.log')}`);
    logRun(`Summary report: ${path.join(config.reportsDir, 'summary.md')}`);
    if (state.finalStatus === 'Failed') throw new Error(`Stress test failed. See ${path.join(config.reportsDir, 'summary.md')}`);
  }
});
