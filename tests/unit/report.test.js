const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createRunState } = require('../../src/state');
const { finalizeReport } = require('../../src/report');

async function buildState(httpError) {
  const reportsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playwright-stress-report-'));
  const config = {
    likeClicks: 0,
    shareClicks: 1,
    reportsDir,
    failOnConsoleError: false,
    telemetry429BackoffMs: 30000,
    maxTelemetry429: 5
  };
  const state = createRunState(config);
  state.navigation.succeeded = true;
  state.actions.share.successful = 1;
  state.actions.share.status = 'completed';
  state.actions.share.responseTimesMs.push(400);
  state.activityLog.push({
    timestamp: '2026-11-19T15:30:00.000Z', action: 'share', event: 'SUCCESS',
    iteration: 1, requested: 1, successful: 1, failed: 0, skipped: 0,
    details: { verifiedBy: 'clipboard write attempted' }
  });
  if (httpError) {
    state.httpErrorResponses.push(httpError);
    if (httpError.category === 'telemetry') state.telemetryRateLimits.push(httpError);
  }
  return { state, config, reportsDir };
}

test('telemetry-only 429 does not mark an otherwise complete Share-only test as Failed', async () => {
  const { state, config, reportsDir } = await buildState({
    status: 429,
    category: 'telemetry',
    url: 'https://cb3newsmonitoringdashboard.lovable.app/__l5e/trackevents'
  });
  try {
    await finalizeReport(state, config);
    assert.equal(state.finalStatus, 'Passed');
    const summary = await fs.readFile(path.join(reportsDir, 'summary.md'), 'utf8');
    assert.match(summary, /Telemetry HTTP 429 responses \(recorded, non-fatal\): 1/);
    const activity = await fs.readFile(path.join(reportsDir, 'activity.log'), 'utf8');
    assert.match(activity, /\[SHARE\] \[1\/1\] \[SUCCESS\]/);
    const activityJson = JSON.parse(await fs.readFile(path.join(reportsDir, 'activity.json'), 'utf8'));
    assert.equal(activityJson.length, 1);
  } finally {
    await fs.rm(reportsDir, { recursive: true, force: true });
  }
});

test('application/API 429 still marks the test as Failed', async () => {
  const { state, config, reportsDir } = await buildState({
    status: 429,
    category: 'application',
    url: 'https://cb3newsmonitoringdashboard.lovable.app/api/share'
  });
  try {
    await finalizeReport(state, config);
    assert.equal(state.finalStatus, 'Failed');
  } finally {
    await fs.rm(reportsDir, { recursive: true, force: true });
  }
});
