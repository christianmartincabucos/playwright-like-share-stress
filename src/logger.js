function logRun(message) {
  console.log(`[RUN] ${message}`);
}

function logAction(state, actionName, event, iteration, requested, details = {}) {
  const action = state.actions[actionName];
  const record = {
    timestamp: new Date().toISOString(),
    action: actionName,
    event,
    iteration: iteration ?? null,
    requested,
    successful: action?.successful ?? 0,
    failed: action?.failed ?? 0,
    skipped: action?.skipped ?? 0,
    details
  };

  if (!Array.isArray(state.activityLog)) state.activityLog = [];
  state.activityLog.push(record);

  const actionLabel = actionName.toUpperCase();
  const stepLabel = iteration == null ? `--/${requested}` : `${iteration}/${requested}`;
  const progress = `success=${record.successful}, failed=${record.failed}, skipped=${record.skipped}`;
  const detailText = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(' | ');
  const suffix = [detailText, progress].filter(Boolean).join(' | ');

  console.log(`[${record.timestamp}] [${actionLabel}] [${stepLabel}] [${event}]${suffix ? ` ${suffix}` : ''}`);
  return record;
}

function formatValue(value) {
  if (typeof value === 'string') return value.replace(/[\r\n]+/g, ' ').slice(0, 500);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

module.exports = { logRun, logAction };
