// Central defaults. Every value can be overridden with an environment variable.
module.exports = {
  targetUrl: process.env.TARGET_URL || 'https://cb3newsmonitoringdashboard.lovable.app/lokal/langtad',
  likeClicks: readInt('LIKE_CLICKS', 1000),
  shareClicks: readInt('SHARE_CLICKS', 1000),
  commentClicks: readInt('COMMENT_CLICKS', 1000),
  delayBetweenClicksMs: readInt('DELAY_BETWEEN_CLICKS_MS', 2000),
  batchSize: readInt('BATCH_SIZE', 25),
  batchCooldownMs: readInt('BATCH_COOLDOWN_MS', 10000),
  telemetry429Paths: readList('TELEMETRY_429_PATHS', ['/__l5e/trackevents']),
  telemetry429BackoffMs: readInt('TELEMETRY_429_BACKOFF_MS', 30000),
  maxTelemetry429: readInt('MAX_TELEMETRY_429', 5),
  failOnConsoleError: readBool('FAIL_ON_CONSOLE_ERROR', false),
  navigationTimeoutMs: readInt('NAVIGATION_TIMEOUT_MS', 30000),
  actionTimeoutMs: readInt('ACTION_TIMEOUT_MS', 10000),
  externalNavigationTimeoutMs: readInt('EXTERNAL_NAVIGATION_TIMEOUT_MS', 10000),
  externalNavigationDetectMs: readInt('EXTERNAL_NAVIGATION_DETECT_MS', 500),
  stateTimeoutMs: readInt('STATE_TIMEOUT_MS', 5000),
  responsiveTimeoutMs: readInt('RESPONSIVE_TIMEOUT_MS', 5000),
  maxConsecutiveFailures: readInt('MAX_CONSECUTIVE_FAILURES', 3),
  screenshotMaxCount: readInt('SCREENSHOT_MAX_COUNT', 20),
  headless: readBool('HEADLESS', true),
  reportsDir: 'reports',
  failuresDir: 'artifacts/failures'
};

function readInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer; received: ${raw}`);
  }
  return value;
}

function readList(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return raw.split(',').map(value => value.trim()).filter(Boolean);
}

function readBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (/^(true|1|yes)$/i.test(raw)) return true;
  if (/^(false|0|no)$/i.test(raw)) return false;
  throw new Error(`${name} must be true/false; received: ${raw}`);
}
