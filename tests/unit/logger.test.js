const test = require('node:test');
const assert = require('node:assert/strict');
const { logAction } = require('../../src/logger');

function buildState() {
  return {
    actions: {
      like: { successful: 1, failed: 0, skipped: 0 },
      share: { successful: 0, failed: 0, skipped: 0 }
    },
    activityLog: []
  };
}

test('logs each action event to the console and stores a structured activity record', () => {
  const state = buildState();
  const originalLog = console.log;
  const output = [];
  console.log = message => output.push(message);
  try {
    logAction(state, 'like', 'SUCCESS', 1, 1000, {
      destination: 'https://www.youtube.com/watch?v=example',
      exitMethod: 'popup_closed',
      returnedToDashboard: true
    });
  } finally {
    console.log = originalLog;
  }

  assert.equal(output.length, 1);
  assert.match(output[0], /\[LIKE\] \[1\/1000\] \[SUCCESS\]/);
  assert.match(output[0], /success=1, failed=0, skipped=0/);
  assert.match(output[0], /exitMethod=popup_closed/);
  assert.equal(state.activityLog.length, 1);
  assert.equal(state.activityLog[0].event, 'SUCCESS');
  assert.equal(state.activityLog[0].successful, 1);
});

test('sanitizes line breaks in console log details', () => {
  const state = buildState();
  const originalLog = console.log;
  let output = '';
  console.log = message => { output = message; };
  try {
    logAction(state, 'share', 'FAILED', 2, 10, { reason: 'request failed\nnew line' });
  } finally {
    console.log = originalLog;
  }

  assert.match(output, /reason=request failed new line/);
  assert.equal(output.includes('\n'), false);
});
