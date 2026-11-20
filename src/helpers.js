const fs = require('node:fs/promises');
const path = require('node:path');
const { readLikeState } = require('./inspect');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function ensureDirectories(config) {
  await fs.mkdir(config.reportsDir, { recursive: true });
  await fs.mkdir(config.failuresDir, { recursive: true });
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function waitForResponsive(page, locator, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (page.isClosed()) throw new Error('Page was closed while waiting for responsiveness.');
    const readyState = await page.evaluate(() => document.readyState).catch(() => 'unavailable');
    const visible = await locator.isVisible().catch(() => false);
    const enabled = await locator.isEnabled().catch(() => false);
    const busy = await page.locator('[aria-busy="true"], [data-loading="true"]').count().catch(() => 0);
    if ((readyState === 'interactive' || readyState === 'complete') && visible && enabled && busy === 0) return;
    await sleep(150);
  }
  throw new Error(`Application did not become responsive within ${timeoutMs} ms.`);
}

async function waitForLikeToggle(locator, previousState, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastState = null;
  while (Date.now() < deadline) {
    const snapshot = await locator.evaluate(element => ({
      ariaLabel: element.getAttribute('aria-label'),
      ariaPressed: element.getAttribute('aria-pressed'),
      ariaChecked: element.getAttribute('aria-checked'),
      dataState: element.getAttribute('data-state'),
      dataLiked: element.getAttribute('data-liked'),
      title: element.getAttribute('title'),
      text: (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 180)
    })).catch(() => null);
    lastState = readLikeState(snapshot);
    if (lastState !== null && lastState !== previousState) return { changed: true, state: lastState };
    await sleep(100);
  }
  return { changed: false, state: lastState };
}

async function captureFailure(page, config, state, action, iteration, error) {
  const detail = {
    timestamp: new Date().toISOString(),
    iteration,
    action,
    message: error && error.message ? error.message : String(error),
    url: (() => { try { return page.url(); } catch (_) { return null; } })(),
    screenshot: null
  };
  const screenshotsAlready = state.errors.filter(item => item.screenshot).length;
  if (screenshotsAlready < config.screenshotMaxCount && !page.isClosed()) {
    const filename = `${action}-${String(iteration).padStart(4, '0')}-${Date.now()}.png`;
    const screenshotPath = path.join(config.failuresDir, filename);
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true, timeout: 5000 });
      detail.screenshot = screenshotPath;
    } catch (screenshotError) {
      detail.screenshotError = screenshotError.message;
    }
  }
  state.errors.push(detail);
  state.actions[action].failureDetails.push(detail);
  return detail;
}

function summarizeTimes(times) {
  if (!times.length) return { averageMs: null, maximumMs: null, minimumMs: null };
  return {
    averageMs: Number((times.reduce((sum, value) => sum + value, 0) / times.length).toFixed(2)),
    maximumMs: Math.max(...times),
    minimumMs: Math.min(...times)
  };
}

module.exports = { sleep, ensureDirectories, writeJson, waitForResponsive, waitForLikeToggle, captureFailure, summarizeTimes };
