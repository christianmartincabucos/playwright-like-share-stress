const { sleep } = require('./helpers');

class StabilityMonitor {
  constructor(page, context, state, targetUrl, config) {
    this.page = page;
    this.context = context;
    this.state = state;
    this.target = new URL(targetUrl);
    this.config = config || {};
    this.fatalReason = null;
    this.attached = false;
    this.telemetryCooldownUntil = 0;
  }

  attach() {
    if (this.attached) return;
    this.attached = true;

    this.page.on('pageerror', error => {
      this.state.jsErrors.push({ timestamp: new Date().toISOString(), message: error.message, stack: error.stack || null, url: this.safeUrl() });
      this.stop(`Uncaught page JavaScript exception: ${error.message}`);
    });

    this.page.on('console', message => {
      if (message.type() === 'error') {
        this.state.consoleErrors.push({
          timestamp: new Date().toISOString(),
          message: message.text(),
          location: typeof message.location === 'function' ? message.location() : null,
          url: this.safeUrl()
        });
      }
    });

    this.page.on('requestfailed', request => {
      const failure = request.failure();
      this.state.failedRequests.push({
        timestamp: new Date().toISOString(),
        method: request.method(),
        url: request.url(),
        resourceType: request.resourceType(),
        error: failure ? failure.errorText : 'Unknown request failure'
      });
      try {
        const failedUrl = new URL(request.url());
        if (failedUrl.origin === this.target.origin && ['xhr', 'fetch'].includes(request.resourceType())) {
          this.stop(`Same-origin application request failed: ${request.method()} ${request.url()}`);
        }
      } catch (_) { /* Keep logging malformed request URLs without crashing the monitor. */ }
    });

    this.page.on('response', response => {
      const status = response.status();
      if (status >= 400) {
        const responseUrl = response.url();
        const telemetryRateLimit = status === 429 && isTelemetryRateLimit(responseUrl, this.config.telemetry429Paths || ['/__l5e/trackevents']);
        const record = {
          timestamp: new Date().toISOString(),
          status,
          method: response.request().method(),
          url: responseUrl,
          category: telemetryRateLimit ? 'telemetry' : 'application'
        };
        this.state.httpErrorResponses.push(record);

        if (telemetryRateLimit) {
          this.state.telemetryRateLimits.push(record);
          const cooldownMs = this.config.telemetry429BackoffMs ?? 30000;
          this.telemetryCooldownUntil = Math.max(this.telemetryCooldownUntil, Date.now() + cooldownMs);
          const maximum = this.config.maxTelemetry429 ?? 5;
          if (this.state.telemetryRateLimits.length >= maximum) {
            this.stop(`Telemetry endpoint returned HTTP 429 ${this.state.telemetryRateLimits.length} times; stopped at the configured safety threshold (${maximum}).`);
          }
        } else if (status === 429) {
          this.stop(`HTTP 429 rate limit observed on a non-telemetry endpoint: ${responseUrl}`);
        } else if (status >= 500) {
          this.stop(`HTTP ${status} server error observed at ${responseUrl}`);
        }
      }
    });

    this.page.on('crash', () => {
      const detail = { timestamp: new Date().toISOString(), url: this.safeUrl(), message: 'Playwright reported that the page crashed.' };
      this.state.browserCrashes.push(detail);
      this.stop(detail.message);
    });

    this.page.on('dialog', async dialog => {
      this.state.dialogs.push({ timestamp: new Date().toISOString(), type: dialog.type(), message: dialog.message() });
      try { await dialog.dismiss(); } catch (_) { /* Page may already be closing. */ }
    });

    this.page.on('popup', () => {
      // The action runner owns popup cleanup so it can record the destination
      // and close it only after the destination URL has been observed.
      this.state.popups += 1;
    });

    this.page.on('framenavigated', frame => {
      if (frame !== this.page.mainFrame()) return;
      const current = frame.url();
      if (!current || current === 'about:blank') return;
      try {
        const next = new URL(current);
        if (next.origin !== this.target.origin) {
          this.state.externalNavigations.push({ timestamp: new Date().toISOString(), from: this.target.href, to: current });
          // External destinations opened by Like/Share are expected. The runner
          // returns to the dashboard immediately after observing the destination.
          return;
        }
        if (next.pathname !== this.target.pathname) {
          this.state.unexpectedNavigations.push({ timestamp: new Date().toISOString(), from: this.target.href, to: current });
          if (this.state.navigation.succeeded) this.stop(`Unexpected same-site main-frame navigation to ${current}`);
        }
      } catch (_) {
        this.stop(`Main frame navigated to an unparseable URL: ${current}`);
      }
    });

    const browser = this.context.browser();
    if (browser) {
      browser.on('disconnected', () => {
        this.state.browserCrashes.push({ timestamp: new Date().toISOString(), message: 'Browser disconnected.' });
        this.stop('Browser disconnected.');
      });
    }
  }

  async waitForTelemetryCooldown() {
    const remainingMs = this.telemetryCooldownUntil - Date.now();
    if (remainingMs <= 0) return;
    const startedAt = new Date().toISOString();
    await sleep(remainingMs);
    this.state.telemetryCooldowns.push({
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: remainingMs
    });
    this.telemetryCooldownUntil = 0;
  }

  stop(reason) {
    if (!this.fatalReason) {
      this.fatalReason = reason;
      this.state.stopReason = reason;
    }
  }

  shouldStop() {
    return Boolean(this.fatalReason);
  }

  safeUrl() {
    try { return this.page.url(); } catch (_) { return null; }
  }
}

function isTelemetryRateLimit(url, pathPatterns) {
  try {
    const pathname = new URL(url).pathname;
    return pathPatterns.some(pattern => pattern && pathname.includes(pattern));
  } catch (_) {
    return false;
  }
}

module.exports = { StabilityMonitor, isTelemetryRateLimit };
