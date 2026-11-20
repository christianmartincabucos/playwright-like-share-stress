const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { StabilityMonitor } = require('../../src/monitor');
const { createRunState } = require('../../src/state');

const targetUrl = 'https://cb3newsmonitoringdashboard.lovable.app/lokal/langtad';
const baseConfig = {
  targetUrl,
  telemetry429Paths: ['/__l5e/trackevents'],
  telemetry429BackoffMs: 30000,
  maxTelemetry429: 5
};

class FakePage extends EventEmitter {
  url() { return targetUrl; }
  mainFrame() { return this.mainFrameObject || (this.mainFrameObject = {}); }
}

function makeResponse(url, status = 429) {
  return {
    status: () => status,
    url: () => url,
    request: () => ({ method: () => 'POST' })
  };
}

test('telemetry endpoint HTTP 429 is recorded but does not immediately stop the run', () => {
  const page = new FakePage();
  const context = { browser: () => null };
  const state = createRunState(baseConfig);
  const monitor = new StabilityMonitor(page, context, state, targetUrl, baseConfig);
  monitor.attach();

  page.emit('response', makeResponse('https://cb3newsmonitoringdashboard.lovable.app/__l5e/trackevents'));

  assert.equal(monitor.shouldStop(), false);
  assert.equal(state.telemetryRateLimits.length, 1);
  assert.equal(state.httpErrorResponses[0].category, 'telemetry');
});

test('application/API HTTP 429 remains fatal', () => {
  const page = new FakePage();
  const context = { browser: () => null };
  const state = createRunState(baseConfig);
  const monitor = new StabilityMonitor(page, context, state, targetUrl, baseConfig);
  monitor.attach();

  page.emit('response', makeResponse('https://cb3newsmonitoringdashboard.lovable.app/api/share'));

  assert.equal(monitor.shouldStop(), true);
  assert.match(monitor.fatalReason, /non-telemetry endpoint/);
  assert.equal(state.httpErrorResponses[0].category, 'application');
});

test('repeated telemetry HTTP 429 responses stop at the configured safety threshold', () => {
  const page = new FakePage();
  const context = { browser: () => null };
  const state = createRunState(baseConfig);
  const monitor = new StabilityMonitor(page, context, state, targetUrl, baseConfig);
  monitor.attach();

  for (let i = 0; i < baseConfig.maxTelemetry429; i += 1) {
    page.emit('response', makeResponse('https://cb3newsmonitoringdashboard.lovable.app/__l5e/trackevents'));
  }

  assert.equal(monitor.shouldStop(), true);
  assert.equal(state.telemetryRateLimits.length, baseConfig.maxTelemetry429);
  assert.match(monitor.fatalReason, /safety threshold/);
});
