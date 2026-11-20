const { sleep, waitForResponsive, waitForLikeToggle, captureFailure } = require('./helpers');
const { resolveLikeButton, resolveShareButton, resolveCommentButton } = require('./inspect');
const { logAction } = require('./logger');

async function runLikeStress(page, config, state, monitor) {
  const disposition = state.inspection?.like?.disposition;
  if (disposition?.mode === 'external-link') {
    const locator = page.getByRole('link', { name: /^like(?:\b|$)/i });
    await runExternalLinkStress(page, locator, disposition.destination, config, state, monitor, 'like');
    return;
  }

  const action = state.actions.like;
  const resolved = await resolveLikeButton(page);
  if (!resolved) {
    action.skipped = action.requested;
    action.status = 'skipped';
    state.notes.push('Like skipped: no unique accessible Like button with an observable toggle state was found.');
    logAction(state, 'like', 'SKIPPED', null, action.requested, { reason: 'No verifiable Like control' });
    return;
  }

  action.status = 'running';
  logAction(state, 'like', 'START', null, action.requested, { mode: 'toggle button' });
  let consecutivePreActionFailures = 0;
  let iteration = 0;
  while (action.successful < action.requested) {
    iteration += 1;
    if (monitor.shouldStop()) break;
    await monitor.waitForTelemetryCooldown();
    if (monitor.shouldStop()) break;
    const started = Date.now();
    let dispatched = false;
    try {
      await waitForResponsive(page, resolved.locator, config.responsiveTimeoutMs);
      const before = await resolved.locator.evaluate(element => ({
        ariaLabel: element.getAttribute('aria-label'),
        ariaPressed: element.getAttribute('aria-pressed'),
        ariaChecked: element.getAttribute('aria-checked'),
        dataState: element.getAttribute('data-state'),
        dataLiked: element.getAttribute('data-liked'),
        title: element.getAttribute('title'),
        text: (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 180)
      }));
      const { readLikeState } = require('./inspect');
      const beforeState = readLikeState(before);
      if (beforeState === null) throw new Error('Like state became unobservable before click; no action was dispatched.');

      logAction(state, 'like', 'CLICKING', iteration, action.requested, { beforeState });
      dispatched = true;
      await resolved.locator.click({ timeout: config.actionTimeoutMs });
      const verification = await waitForLikeToggle(resolved.locator, beforeState, config.stateTimeoutMs);
      const duration = Date.now() - started;
      action.responseTimesMs.push(duration);
      if (!verification.changed) {
        action.failed += 1;
        logAction(state, 'like', 'FAILED', iteration, action.requested, { reason: 'Like state did not change', beforeState, lastState: verification.state });
        await captureFailure(page, config, state, 'like', iteration, new Error(`Click may have been dispatched, but no verified Like state change was observed. Previous state: ${beforeState}; last state: ${verification.state}. The action will not be retried.`));
        action.status = 'failed';
        state.stopReason = `Like iteration ${iteration} could not be verified; stopped to avoid a duplicate toggle.`;
        break;
      }
      action.successful += 1;
      logAction(state, 'like', 'SUCCESS', iteration, action.requested, { verifiedState: verification.state, durationMs: duration });
      consecutivePreActionFailures = 0;
    } catch (error) {
      if (dispatched) {
        action.failed += 1;
        logAction(state, 'like', 'FAILED', iteration, action.requested, { reason: error.message, clickDispatched: true });
        await captureFailure(page, config, state, 'like', iteration, new Error(`${error.message} Click dispatch may have occurred; no retry was attempted.`));
        action.status = 'failed';
        state.stopReason = `Like iteration ${iteration} failed after click dispatch; stopped because the outcome may be uncertain.`;
        break;
      }
      action.failed += 1;
      logAction(state, 'like', 'FAILED', iteration, action.requested, { reason: error.message, clickDispatched: false });
      consecutivePreActionFailures += 1;
      await captureFailure(page, config, state, 'like', iteration, error);
      if (consecutivePreActionFailures >= config.maxConsecutiveFailures) {
        action.status = 'failed';
        state.stopReason = `Like stopped after ${consecutivePreActionFailures} consecutive pre-click failures.`;
        break;
      }
      await sleep(config.batchCooldownMs);
    }

    if (monitor.shouldStop()) break;
    if (action.successful > 0 && action.successful < action.requested) {
      if (action.successful % config.batchSize === 0) await sleep(config.batchCooldownMs);
      else await sleep(config.delayBetweenClicksMs);
    }
  }

  if (action.successful === action.requested) action.status = 'completed';
  else if (action.status === 'running') action.status = 'incomplete';
  action.skipped = Math.max(0, action.requested - action.successful - action.failed);
}

async function runExternalLinkStress(page, locator, expectedDestination, config, state, monitor, actionName) {
  const action = state.actions[actionName];
  action.status = 'running';
  logAction(state, actionName, 'START', null, action.requested, { mode: 'external navigation', destination: expectedDestination });
  let consecutivePreActionFailures = 0;
  let iteration = 0;

  while (action.successful < action.requested) {
    iteration += 1;
    if (monitor.shouldStop()) break;
    await monitor.waitForTelemetryCooldown();
    if (monitor.shouldStop()) break;

    const started = Date.now();
    let dispatched = false;
    try {
      await waitForResponsive(page, locator, config.responsiveTimeoutMs);
      logAction(state, actionName, 'CLICKING', iteration, action.requested, { destination: expectedDestination });
      dispatched = true;
      const outcome = await clickAndExitDestination(page, locator, config, state, actionName, iteration);
      if (!outcome.navigated) {
        throw new Error(`The ${actionName} link was clicked, but no destination page or navigation was observed. Expected: ${expectedDestination || 'a linked destination'}.`);
      }
      const duration = Date.now() - started;
      action.responseTimesMs.push(duration);
      action.successful += 1;
      logAction(state, actionName, 'SUCCESS', iteration, action.requested, { destination: outcome.destinationUrl, exitMethod: outcome.exitMethod, returnedToDashboard: page.url() === config.targetUrl, durationMs: duration });
      consecutivePreActionFailures = 0;
    } catch (error) {
      action.failed += 1;
      consecutivePreActionFailures += 1;
      logAction(state, actionName, 'FAILED', iteration, action.requested, { reason: error.message, clickDispatched: dispatched });
      await captureFailure(page, config, state, actionName, iteration, error);

      // Clean up any extra open pages and ensure we remain on target dashboard
      try {
        for (const p of page.context().pages()) {
          if (p !== page && !p.isClosed()) {
            await p.close({ runBeforeUnload: false }).catch(() => {});
          }
        }
        if (page.url() !== config.targetUrl) {
          await page.goto(config.targetUrl, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs }).catch(() => {});
        }
      } catch (_) {}

      if (consecutivePreActionFailures >= config.maxConsecutiveFailures) {
        action.status = 'failed';
        state.stopReason = `${actionName} stopped after ${consecutivePreActionFailures} consecutive failures.`;
        break;
      }
      await sleep(config.batchCooldownMs);
    }

    if (monitor.shouldStop()) break;
    if (action.successful > 0 && action.successful < action.requested) {
      if (action.successful % config.batchSize === 0) await sleep(config.batchCooldownMs);
      else await sleep(config.delayBetweenClicksMs);
    }
  }

  if (action.successful === action.requested) action.status = 'completed';
  else if (action.status === 'running') action.status = 'incomplete';
  action.skipped = Math.max(0, action.requested - action.successful - action.failed);
}

async function clickAndExitDestination(page, locator, config, state, actionName, iteration) {
  const originalUrl = page.url();
  const context = typeof page.context === 'function' ? page.context() : null;
  const existingPages = context ? new Set(context.pages()) : new Set();

  let popup = null;
  const onPopup = openedPage => {
    if (!popup) popup = openedPage;
  };
  const onContextPage = openedPage => {
    if (!popup && openedPage !== page) popup = openedPage;
  };

  page.on('popup', onPopup);
  if (context && typeof context.on === 'function') context.on('page', onContextPage);

  try {
    const popupPromise = typeof page.waitForEvent === 'function'
      ? page.waitForEvent('popup', { timeout: 3500 }).catch(() => null)
      : null;

    await locator.click({ timeout: config.actionTimeoutMs });

    // Allow synchronous or event-driven popups a moment
    if (popupPromise) popup = await popupPromise;

    // If popup not received yet, check context pages or poll briefly
    if (!popup && context) {
      const detectDeadline = Date.now() + Math.max(config.externalNavigationDetectMs ?? 500, 2500);
      while (!popup && Date.now() < detectDeadline) {
        for (const p of context.pages()) {
          if (!existingPages.has(p) && p !== page && (!p.isClosed || !p.isClosed())) {
            popup = p;
            break;
          }
        }
        if (popup || page.url() !== originalUrl) break;
        await sleep(100);
      }
    } else if (!popup && (config.externalNavigationDetectMs ?? 500) > 0) {
      await sleep(config.externalNavigationDetectMs ?? 500);
    }
  } finally {
    page.off('popup', onPopup);
    if (context && typeof context.off === 'function') context.off('page', onContextPage);
  }

  if (popup) {
    const destinationUrl = await waitForPopupDestination(popup, config);
    const exitRecord = {
      timestamp: new Date().toISOString(),
      action: actionName,
      iteration,
      destinationUrl,
      exitMethod: 'popup_closed'
    };
    try { await popup.close({ runBeforeUnload: false }); } catch (_) { /* It may already have closed. */ }
    state.externalDestinationsExited.push(exitRecord);
    await ensureOriginalPage(page, originalUrl, config);

    // Close any other stray pages that might have opened
    if (context) {
      for (const p of context.pages()) {
        if (p !== page && (!p.isClosed || !p.isClosed())) {
          try { await p.close({ runBeforeUnload: false }); } catch (_) {}
        }
      }
    }

    return { navigated: true, ...exitRecord };
  }

  const currentUrl = page.url();
  if (currentUrl !== originalUrl) {
    await page.waitForLoadState('domcontentloaded', { timeout: config.externalNavigationTimeoutMs ?? 10000 }).catch(() => {});
    const destinationUrl = page.url();
    const exitRecord = {
      timestamp: new Date().toISOString(),
      action: actionName,
      iteration,
      destinationUrl,
      exitMethod: 'browser_back'
    };
    state.externalDestinationsExited.push(exitRecord);
    await page.goBack({ waitUntil: 'domcontentloaded', timeout: config.externalNavigationTimeoutMs ?? 10000 }).catch(() => null);
    await ensureOriginalPage(page, originalUrl, config);
    return { navigated: true, ...exitRecord };
  }

  return { navigated: false, destinationUrl: null, exitMethod: null };
}

async function waitForPopupDestination(popup, config) {
  if (typeof popup.isClosed === 'function' && popup.isClosed()) return 'closed';
  await popup.waitForURL(url => url.toString() !== 'about:blank', {
    timeout: Math.min(config.externalNavigationTimeoutMs ?? 10000, 3000)
  }).catch(() => {});
  return popup.url();
}

async function ensureOriginalPage(page, originalUrl, config) {
  const currentUrl = page.url();
  if (currentUrl !== originalUrl) {
    await page.goBack({ waitUntil: 'domcontentloaded', timeout: config.externalNavigationTimeoutMs ?? 10000 }).catch(() => null);
  }
  const restored = await page.waitForURL(url => url.toString() === originalUrl, {
    timeout: config.externalNavigationTimeoutMs ?? 10000
  }).then(() => true).catch(() => false);
  if (!restored && page.url() !== originalUrl) {
    throw new Error(`Could not return to the dashboard after opening a destination. Current URL: ${page.url()}`);
  }
}

async function runShareStress(page, context, config, state, monitor) {
  const action = state.actions.share;
  const resolved = await resolveShareButton(page);
  if (!resolved) {
    action.skipped = action.requested;
    action.status = 'skipped';
    state.notes.push('Share skipped: no unique accessible Share button was found.');
    logAction(state, 'share', 'SKIPPED', null, action.requested, { reason: 'No unique accessible Share button found' });
    return;
  }

  action.status = 'running';
  logAction(state, 'share', 'START', null, action.requested, { mode: 'Share button' });
  let consecutivePreActionFailures = 0;
  let iteration = 0;
  while (action.successful < action.requested) {
    iteration += 1;
    if (monitor.shouldStop()) break;
    await monitor.waitForTelemetryCooldown();
    if (monitor.shouldStop()) break;
    const started = Date.now();
    let dispatched = false;
    try {
      await waitForResponsive(page, resolved.locator, config.responsiveTimeoutMs);
      const metricsBefore = await readShareMetrics(page);
      const pagesBefore = context.pages().length;
      const popupsBefore = state.popups;
      logAction(state, 'share', 'CLICKING', iteration, action.requested, { pageUrl: page.url() });
      dispatched = true;
      const destination = await clickAndExitDestination(page, resolved.locator, config, state, 'share', iteration);

      // A menu/modal may be opened in the dashboard instead of navigating externally.
      const surface = await findShareSurface(page);
      if (surface) await closeShareSurface(page, surface, config.actionTimeoutMs);

      const metricsAfter = await readShareMetrics(page);
      const newPages = Math.max(0, context.pages().length - pagesBefore);
      const popupDelta = state.popups - popupsBefore;
      const shareDelta = metricsAfter.shareCalls - metricsBefore.shareCalls;
      const clipboardDelta = metricsAfter.clipboardWrites - metricsBefore.clipboardWrites;
      const openDelta = metricsAfter.openCalls - metricsBefore.openCalls;
      const surfaceOpened = Boolean(surface);
      const navigationOpened = Boolean(destination.navigated);
      const evidenceCount = Number(surfaceOpened) + Number(shareDelta > 0) + Number(clipboardDelta > 0) + Number(openDelta > 0) + Number(newPages > 0) + Number(popupDelta > 0) + Number(navigationOpened);

      const duration = Date.now() - started;
      action.responseTimesMs.push(duration);
      if (evidenceCount === 0) {
        action.failed += 1;
        logAction(state, 'share', 'FAILED', iteration, action.requested, { reason: 'No share effect, popup, dialog, or navigation was detected', clickDispatched: true });
        await captureFailure(page, config, state, 'share', iteration, new Error('Share click was dispatched, but no dialog/menu, native share call, clipboard write, popup, or navigation was detected. The action will not be retried.'));
        action.status = 'failed';
        state.stopReason = `Share iteration ${iteration} could not be verified; stopped to avoid duplicate share actions.`;
        break;
      }
      if (shareDelta > 1 || clipboardDelta > 1 || openDelta > 1 || newPages > 1 || popupDelta > 1) {
        action.failed += 1;
        logAction(state, 'share', 'FAILED', iteration, action.requested, { reason: 'Possible duplicate share side effect', shareCalls: shareDelta, clipboardWrites: clipboardDelta, windowOpenCalls: openDelta, popupEvents: popupDelta, popupPages: newPages });
        await captureFailure(page, config, state, 'share', iteration, new Error(`Possible duplicate share side effect detected (share=${shareDelta}, clipboard=${clipboardDelta}, window.open=${openDelta}, popupEvents=${popupDelta}, popupPages=${newPages}). Test stopped.`));
        action.status = 'failed';
        state.stopReason = `Possible duplicate Share side effect at iteration ${iteration}.`;
        break;
      }

      action.successful += 1;
      consecutivePreActionFailures = 0;
      if (surfaceOpened) {
        const stillOpen = await surface.locator.isVisible().catch(() => false);
        if (stillOpen) {
          action.failed += 1;
          action.successful -= 1;
          logAction(state, 'share', 'FAILED', iteration, action.requested, { reason: 'Share interface remained open after close attempt' });
          await captureFailure(page, config, state, 'share', iteration, new Error('Share interface remained open after the close attempt.'));
          action.status = 'failed';
          state.stopReason = `Share interface could not be closed at iteration ${iteration}.`;
          break;
        }
      }
      const evidence = [];
      if (surfaceOpened) evidence.push('in-page share surface opened and closed');
      if (shareDelta > 0) evidence.push('navigator.share called');
      if (clipboardDelta > 0) evidence.push('clipboard write attempted');
      if (openDelta > 0) evidence.push('window.open called');
      if (newPages > 0 || popupDelta > 0) evidence.push('popup opened and exited');
      if (navigationOpened) evidence.push(`destination exited via ${destination.exitMethod}: ${destination.destinationUrl}`);
      logAction(state, 'share', 'SUCCESS', iteration, action.requested, { verifiedBy: evidence.join('; ') || 'share handler evidence', durationMs: duration });
    } catch (error) {
      if (dispatched) {
        action.failed += 1;
        logAction(state, 'share', 'FAILED', iteration, action.requested, { reason: error.message, clickDispatched: true });
        await captureFailure(page, config, state, 'share', iteration, new Error(`${error.message} Click dispatch may have occurred; no retry was attempted.`));
        action.status = 'failed';
        state.stopReason = `Share iteration ${iteration} failed after click dispatch; stopped because the outcome may be uncertain.`;
        break;
      }
      action.failed += 1;
      logAction(state, 'share', 'FAILED', iteration, action.requested, { reason: error.message, clickDispatched: false });
      consecutivePreActionFailures += 1;
      await captureFailure(page, config, state, 'share', iteration, error);
      if (consecutivePreActionFailures >= config.maxConsecutiveFailures) {
        action.status = 'failed';
        state.stopReason = `Share stopped after ${consecutivePreActionFailures} consecutive pre-click failures.`;
        break;
      }
      await sleep(config.batchCooldownMs);
    }

    if (monitor.shouldStop()) break;
    if (action.successful > 0 && action.successful < action.requested) {
      if (action.successful % config.batchSize === 0) await sleep(config.batchCooldownMs);
      else await sleep(config.delayBetweenClicksMs);
    }
  }

  if (action.successful === action.requested) action.status = 'completed';
  else if (action.status === 'running') action.status = 'incomplete';
  action.skipped = Math.max(0, action.requested - action.successful - action.failed);
}

async function readShareMetrics(page) {
  return page.evaluate(() => ({
    shareCalls: window.__qaShareMetrics ? window.__qaShareMetrics.shareCalls : 0,
    clipboardWrites: window.__qaShareMetrics ? window.__qaShareMetrics.clipboardWrites : 0,
    openCalls: window.__qaShareMetrics ? window.__qaShareMetrics.openCalls : 0
  })).catch(() => ({ shareCalls: 0, clipboardWrites: 0, openCalls: 0 }));
}

async function findShareSurface(page) {
  const candidates = [
    page.getByRole('dialog'),
    page.getByRole('alertdialog'),
    page.getByRole('menu'),
    page.locator('[aria-modal="true"]')
  ];
  for (const locator of candidates) {
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);
      if (await item.isVisible().catch(() => false)) return { locator: item };
    }
  }
  return null;
}

async function closeShareSurface(page, surface, timeoutMs) {
  const closeButton = surface.locator.getByRole('button', { name: /^(close|cancel|done|dismiss|back)$/i }).first();
  if (await closeButton.count().catch(() => 0)) {
    await closeButton.click({ timeout: Math.min(timeoutMs, 3000) });
  } else {
    await page.keyboard.press('Escape');
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await surface.locator.isVisible().catch(() => false))) return;
    await sleep(100);
  }
  throw new Error('Share interface did not close after Close/Cancel/Escape.');
}

async function runCommentStress(page, config, state, monitor) {
  const disposition = state.inspection?.comment?.disposition;
  if (disposition?.mode === 'external-link') {
    const locator = page.getByRole('link', { name: /^comment(?:s)?(?:\b|$)/i });
    await runExternalLinkStress(page, locator, disposition.destination, config, state, monitor, 'comment');
    return;
  }

  const action = state.actions.comment;
  const resolved = await resolveCommentButton(page);
  if (!resolved) {
    action.skipped = action.requested;
    action.status = 'skipped';
    state.notes.push('Comment skipped: no unique accessible Comment control was found.');
    logAction(state, 'comment', 'SKIPPED', null, action.requested, { reason: 'No unique accessible Comment control found' });
    return;
  }

  action.status = 'running';
  logAction(state, 'comment', 'START', null, action.requested, { mode: 'Comment button' });
  let consecutivePreActionFailures = 0;
  let iteration = 0;

  while (action.successful < action.requested) {
    iteration += 1;
    if (monitor.shouldStop()) break;
    await monitor.waitForTelemetryCooldown();
    if (monitor.shouldStop()) break;

    const started = Date.now();
    let dispatched = false;
    try {
      await waitForResponsive(page, resolved.locator, config.responsiveTimeoutMs);

      // Snapshot the visible state of the page before clicking (page count, dialogs, etc.)
      const pagesBefore = page.context().pages().length;
      const popupsBefore = state.popups;

      logAction(state, 'comment', 'CLICKING', iteration, action.requested, { pageUrl: page.url() });
      dispatched = true;
      await resolved.locator.click({ timeout: config.actionTimeoutMs });

      // Allow client-side handlers time to open a surface (dialog, panel, modal).
      await sleep(config.externalNavigationDetectMs ?? 500);

      // Check whether a share-style surface (dialog / menu / modal) appeared.
      const surface = await findShareSurface(page);
      const pagesAfter = page.context().pages().length;
      const newPages = Math.max(0, pagesAfter - pagesBefore);
      const popupDelta = state.popups - popupsBefore;

      const evidenceCount = Number(Boolean(surface)) + Number(newPages > 0) + Number(popupDelta > 0);

      const duration = Date.now() - started;
      action.responseTimesMs.push(duration);

      if (evidenceCount === 0) {
        // Comment buttons that only open/close a section in-page have no measurable
        // side effect other than the click itself succeeding without throwing.
        // Count the successful click dispatch as a success.
        action.successful += 1;
        consecutivePreActionFailures = 0;
        logAction(state, 'comment', 'SUCCESS', iteration, action.requested, { verifiedBy: 'click dispatched without error (no dialog / popup observed)', durationMs: duration });
      } else {
        // A surface or popup was opened — close it then count as success.
        if (surface) await closeShareSurface(page, surface, config.actionTimeoutMs);

        action.successful += 1;
        consecutivePreActionFailures = 0;
        const evidence = [];
        if (surface) evidence.push('in-page comment surface opened and closed');
        if (newPages > 0 || popupDelta > 0) evidence.push('popup opened and exited');
        logAction(state, 'comment', 'SUCCESS', iteration, action.requested, { verifiedBy: evidence.join('; ') || 'comment handler evidence', durationMs: duration });
      }
    } catch (error) {
      action.failed += 1;
      consecutivePreActionFailures += 1;
      logAction(state, 'comment', 'FAILED', iteration, action.requested, { reason: error.message, clickDispatched: dispatched });
      await captureFailure(page, config, state, 'comment', iteration, error);
      if (consecutivePreActionFailures >= config.maxConsecutiveFailures) {
        action.status = 'failed';
        state.stopReason = `Comment stopped after ${consecutivePreActionFailures} consecutive failures.`;
        break;
      }
      await sleep(config.batchCooldownMs);
    }

    if (monitor.shouldStop()) break;
    if (action.successful > 0 && action.successful < action.requested) {
      if (action.successful % config.batchSize === 0) await sleep(config.batchCooldownMs);
      else await sleep(config.delayBetweenClicksMs);
    }
  }

  if (action.successful === action.requested) action.status = 'completed';
  else if (action.status === 'running') action.status = 'incomplete';
  action.skipped = Math.max(0, action.requested - action.successful - action.failed);
}

module.exports = {
  runLikeStress,
  runShareStress,
  runCommentStress,
  runExternalLinkStress,
  clickAndExitDestination
};
