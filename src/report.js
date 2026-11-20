const fs = require('node:fs/promises');
const path = require('node:path');
const { summarizeTimes } = require('./helpers');

async function finalizeReport(state, config) {
  state.finishedAt = new Date().toISOString();
  const started = Date.parse(state.startedAt);
  state.executionTimeMs = Math.max(0, Date.now() - started);

  for (const key of Object.keys(state.actions)) {
    if (state.actions[key]) {
      state.actions[key].timing = summarizeTimes(state.actions[key].responseTimesMs || []);
      delete state.actions[key].responseTimesMs;
    }
  }

  const activeKeys = Object.keys(state.actions).filter(k => state.actions[k] && state.actions[k].requested > 0);
  const allRequestedCompleted = activeKeys.length > 0 && activeKeys.every(k => state.actions[k].successful === state.actions[k].requested);
  const observedFailure = Boolean(
    state.errors.length || state.jsErrors.length || (config.failOnConsoleError && state.consoleErrors.length) ||
    state.browserCrashes.length || state.unexpectedNavigations.length ||
    state.httpErrorResponses.some(item => item.status >= 500 || (item.status === 429 && item.category !== 'telemetry')) ||
    state.failedRequests.some(item => {
      try { return new URL(item.url).origin === new URL(state.targetUrl).origin && ['xhr', 'fetch'].includes(item.resourceType); }
      catch (_) { return false; }
    }) || Object.values(state.actions).some(act => act && act.failed > 0)
  );
  if (observedFailure) state.finalStatus = 'Failed';
  else if (allRequestedCompleted && state.navigation.succeeded) state.finalStatus = 'Passed';
  else state.finalStatus = 'Incomplete';

  await fs.mkdir(config.reportsDir, { recursive: true });
  await fs.writeFile(path.join(config.reportsDir, 'report.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(config.reportsDir, 'errors.json'), `${JSON.stringify(state.errors, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(config.reportsDir, 'activity.json'), `${JSON.stringify(state.activityLog || [], null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(config.reportsDir, 'activity.log'), renderActivityLog(state.activityLog || []), 'utf8');
  await fs.writeFile(path.join(config.reportsDir, 'summary.md'), renderMarkdown(state, config), 'utf8');
  return state;
}

function renderMarkdown(state, config) {
  const action = key => state.actions[key];
  const avg = key => action(key).timing.averageMs == null ? 'N/A' : `${action(key).timing.averageMs} ms`;
  const max = key => action(key).timing.maximumMs == null ? 'N/A' : `${action(key).timing.maximumMs} ms`;
  const like = action('like');
  const share = action('share');
  const comment = action('comment');
  const totalSuccess = like.successful + share.successful + comment.successful;
  const totalRequested = like.requested + share.requested + comment.requested;
  const lines = [
    '# Playwright Like / Share / Comment Stress Test', '',
    `- **Final application status:** ${state.finalStatus}`,
    `- **Target URL:** ${state.targetUrl}`,
    `- **Started:** ${state.startedAt}`,
    `- **Finished:** ${state.finishedAt || 'Not finished'}`,
    `- **Total execution time:** ${(state.executionTimeMs / 1000).toFixed(2)} seconds`,
    `- **Overall interactions:** ${totalSuccess}/${totalRequested} verified`,
    '', '## Interaction results', '',
    '| Metric | Like | Share | Comment |', '|---|---:|---:|---:|',
    `| Requested | ${like.requested} | ${share.requested} | ${comment.requested} |`,
    `| Successful | ${like.successful} | ${share.successful} | ${comment.successful} |`,
    `| Failed | ${like.failed} | ${share.failed} | ${comment.failed} |`,
    `| Skipped / not run | ${like.skipped} | ${share.skipped} | ${comment.skipped} |`,
    `| Status | ${like.status} | ${share.status} | ${comment.status} |`,
    `| Average response time | ${avg('like')} | ${avg('share')} | ${avg('comment')} |`,
    `| Maximum response time | ${max('like')} | ${max('share')} | ${max('comment')} |`,
    '', '## Stability metrics', '',
    `- JavaScript page errors: ${state.jsErrors.length}`,
    `- Console errors: ${state.consoleErrors.length} (fatal on console error: ${config.failOnConsoleError ? 'yes' : 'no'})`,
    `- Failed network requests: ${state.failedRequests.length}`,
    `- HTTP 4xx/5xx responses: ${state.httpErrorResponses.length}`,
    `- Telemetry HTTP 429 responses (recorded, non-fatal): ${state.telemetryRateLimits.length}`,
    `- Application HTTP 429 responses (fatal): ${state.httpErrorResponses.filter(item => item.status === 429 && item.category !== 'telemetry').length}`,
    `- Telemetry cooldowns applied: ${state.telemetryCooldowns.length}`,
    `- Telemetry backoff: ${config.telemetry429BackoffMs} ms; stop threshold: ${config.maxTelemetry429} telemetry 429 responses`,
    `- Browser/page crashes or disconnects: ${state.browserCrashes.length}`,
    `- Unexpected same-site navigations: ${state.unexpectedNavigations.length}`,
    `- External main-frame navigations observed: ${state.externalNavigations.length}`,
    `- External destinations exited (popup closed or browser Back): ${state.externalDestinationsExited.length}`,
    `  - Popup tabs closed: ${state.externalDestinationsExited.filter(item => item.exitMethod === 'popup_closed').length}`,
    `  - Same-tab redirects returned with Back: ${state.externalDestinationsExited.filter(item => item.exitMethod === 'browser_back').length}`,
    `- Dialogs observed: ${state.dialogs.length}`,
    `- Popups observed: ${state.popups}`,
    `- Live activity events recorded: ${(state.activityLog || []).length}`,
    '', '## Preflight inspection', '',
    `- Navigation succeeded: ${state.navigation.succeeded}`,
    `- HTTP status: ${state.navigation.status == null ? 'N/A' : state.navigation.status}`,
    `- Like disposition: ${state.inspection?.like?.disposition?.reason || (state.inspection?.like?.disposition?.runnable ? 'Runnable control' : 'Not inspected')}`, 
    `- Share disposition: ${state.inspection?.share?.disposition?.runnable ? 'Runnable accessible button' : state.inspection?.share?.disposition?.reason || 'Not inspected'}`,
    `- Comment disposition: ${state.inspection?.comment?.disposition?.runnable ? 'Runnable accessible button' : state.inspection?.comment?.disposition?.reason || 'Not inspected'}`,
    '', '## Run notes', ''
  ];
  if (!state.notes.length) lines.push('None.');
  else state.notes.forEach(note => lines.push(`- ${note}`));
  lines.push('', '## Stop reason', '', state.stopReason || 'None', '', '## Error details', '');
  if (!state.errors.length) lines.push('No interaction errors were recorded.');
  else {
    state.errors.forEach((error, index) => {
      lines.push(`${index + 1}. **${error.action} iteration ${error.iteration}** — ${error.timestamp}`, `   - ${error.message}`, `   - URL: ${error.url || 'N/A'}`, `   - Screenshot: ${error.screenshot || error.screenshotError || 'Not captured'}`);
    });
  }
  lines.push('', '## Supporting files', '', '- `report.json`: complete machine-readable run data', '- `activity.log`: readable live-action log', '- `activity.json`: structured activity events', '- `errors.json`: interaction errors and screenshot paths', '- `preflight.json`: accessible-control and DOM inventory', '- `playwright-results.json`: Playwright runner output', '- `artifacts/failures/`: screenshots captured on interaction failures', '');
  return lines.join('\n');
}

function renderActivityLog(events) {
  return events.map(event => {
    const step = event.iteration == null ? `--/${event.requested}` : `${event.iteration}/${event.requested}`;
    const details = Object.entries(event.details || {})
      .map(([key, value]) => `${key}=${typeof value === 'string' ? value.replace(/[\r\n]+/g, ' ') : JSON.stringify(value)}`)
      .join(' | ');
    const action = String(event.action || '').toUpperCase();
    return `[${event.timestamp}] [${action}] [${step}] [${event.event}]${details ? ` ${details}` : ''} | success=${event.successful} failed=${event.failed} skipped=${event.skipped}`;
  }).join('\n') + (events.length ? '\n' : '');
}

async function finalizeCommentReport(state, config) {
  state.finishedAt = new Date().toISOString();
  const started = Date.parse(state.startedAt);
  state.executionTimeMs = Math.max(0, Date.now() - started);

  state.actions.comment.timing = summarizeTimes(state.actions.comment.responseTimesMs);
  delete state.actions.comment.responseTimesMs;

  const commentCompleted = state.actions.comment.successful === state.actions.comment.requested;
  const observedFailure = Boolean(
    state.errors.length || state.jsErrors.length || (config.failOnConsoleError && state.consoleErrors.length) ||
    state.browserCrashes.length || state.unexpectedNavigations.length ||
    state.httpErrorResponses.some(item => item.status >= 500 || (item.status === 429 && item.category !== 'telemetry')) ||
    state.failedRequests.some(item => {
      try { return new URL(item.url).origin === new URL(state.targetUrl).origin && ['xhr', 'fetch'].includes(item.resourceType); }
      catch (_) { return false; }
    }) || state.actions.comment.failed
  );
  if (observedFailure) state.finalStatus = 'Failed';
  else if (commentCompleted && state.navigation.succeeded) state.finalStatus = 'Passed';
  else state.finalStatus = 'Incomplete';

  await fs.mkdir(config.reportsDir, { recursive: true });
  await fs.writeFile(path.join(config.reportsDir, 'report-comment.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(config.reportsDir, 'errors-comment.json'), `${JSON.stringify(state.errors, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(config.reportsDir, 'activity.json'), `${JSON.stringify(state.activityLog || [], null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(config.reportsDir, 'activity.log'), renderActivityLog(state.activityLog || []), 'utf8');
  await fs.writeFile(path.join(config.reportsDir, 'summary-comment.md'), renderCommentMarkdown(state, config), 'utf8');
  return state;
}

function renderCommentMarkdown(state, config) {
  const comment = state.actions.comment;
  const avg = comment.timing.averageMs == null ? 'N/A' : `${comment.timing.averageMs} ms`;
  const max = comment.timing.maximumMs == null ? 'N/A' : `${comment.timing.maximumMs} ms`;
  const lines = [
    '# Playwright Comment Stress Test', '',
    `- **Final application status:** ${state.finalStatus}`,
    `- **Target URL:** ${state.targetUrl}`,
    `- **Started:** ${state.startedAt}`,
    `- **Finished:** ${state.finishedAt || 'Not finished'}`,
    `- **Total execution time:** ${(state.executionTimeMs / 1000).toFixed(2)} seconds`,
    `- **Overall interactions:** ${comment.successful}/${comment.requested} verified`,
    '', '## Interaction results', '',
    '| Metric | Comment |', '|---|---:|',
    `| Requested | ${comment.requested} |`,
    `| Successful | ${comment.successful} |`,
    `| Failed | ${comment.failed} |`,
    `| Skipped / not run | ${comment.skipped} |`,
    `| Status | ${comment.status} |`,
    `| Average response time | ${avg} |`,
    `| Maximum response time | ${max} |`,
    '', '## Stability metrics', '',
    `- JavaScript page errors: ${state.jsErrors.length}`,
    `- Console errors: ${state.consoleErrors.length} (fatal on console error: ${config.failOnConsoleError ? 'yes' : 'no'})`,
    `- Failed network requests: ${state.failedRequests.length}`,
    `- HTTP 4xx/5xx responses: ${state.httpErrorResponses.length}`,
    `- Telemetry HTTP 429 responses (recorded, non-fatal): ${state.telemetryRateLimits.length}`,
    `- Browser/page crashes or disconnects: ${state.browserCrashes.length}`,
    `- Unexpected same-site navigations: ${state.unexpectedNavigations.length}`,
    `- Dialogs observed: ${state.dialogs.length}`,
    `- Popups observed: ${state.popups}`,
    `- Live activity events recorded: ${(state.activityLog || []).length}`,
    '', '## Preflight inspection', '',
    `- Navigation succeeded: ${state.navigation.succeeded}`,
    `- HTTP status: ${state.navigation.status == null ? 'N/A' : state.navigation.status}`,
    `- Comment disposition: ${state.inspection?.comment?.disposition?.runnable ? 'Runnable accessible button' : state.inspection?.comment?.disposition?.reason || 'Not inspected'}`,
    '', '## Run notes', ''
  ];
  if (!state.notes.length) lines.push('None.');
  else state.notes.forEach(note => lines.push(`- ${note}`));
  lines.push('', '## Stop reason', '', state.stopReason || 'None', '', '## Error details', '');
  if (!state.errors.length) lines.push('No interaction errors were recorded.');
  else {
    state.errors.forEach((error, index) => {
      lines.push(`${index + 1}. **${error.action} iteration ${error.iteration}** — ${error.timestamp}`, `   - ${error.message}`, `   - URL: ${error.url || 'N/A'}`, `   - Screenshot: ${error.screenshot || error.screenshotError || 'Not captured'}`);
    });
  }
  lines.push('', '## Supporting files', '', '- `report-comment.json`: complete machine-readable run data', '- `activity.log`: readable live-action log', '- `activity.json`: structured activity events', '- `errors-comment.json`: interaction errors and screenshot paths', '- `preflight-comment.json`: accessible-control and DOM inventory', '- `playwright-results.json`: Playwright runner output', '- `artifacts/failures/`: screenshots captured on interaction failures', '');
  return lines.join('\n');
}


async function finalizeLikeReport(state, config) {
  state.finishedAt = new Date().toISOString();
  const started = Date.parse(state.startedAt);
  state.executionTimeMs = Math.max(0, Date.now() - started);

  state.actions.like.timing = summarizeTimes(state.actions.like.responseTimesMs || []);
  delete state.actions.like.responseTimesMs;

  const likeCompleted = state.actions.like.successful === state.actions.like.requested;
  const observedFailure = Boolean(
    state.errors.length || state.jsErrors.length || (config.failOnConsoleError && state.consoleErrors.length) ||
    state.browserCrashes.length || state.unexpectedNavigations.length ||
    state.httpErrorResponses.some(item => item.status >= 500 || (item.status === 429 && item.category !== 'telemetry')) ||
    state.failedRequests.some(item => {
      try { return new URL(item.url).origin === new URL(state.targetUrl).origin && ['xhr', 'fetch'].includes(item.resourceType); }
      catch (_) { return false; }
    }) || state.actions.like.failed
  );
  if (observedFailure) state.finalStatus = 'Failed';
  else if (likeCompleted && state.navigation.succeeded) state.finalStatus = 'Passed';
  else state.finalStatus = 'Incomplete';

  await fs.mkdir(config.reportsDir, { recursive: true });
  await fs.writeFile(path.join(config.reportsDir, 'report-like.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(config.reportsDir, 'errors-like.json'), `${JSON.stringify(state.errors, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(config.reportsDir, 'activity.json'), `${JSON.stringify(state.activityLog || [], null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(config.reportsDir, 'activity.log'), renderActivityLog(state.activityLog || []), 'utf8');
  await fs.writeFile(path.join(config.reportsDir, 'summary-like.md'), renderLikeMarkdown(state, config), 'utf8');
  return state;
}

function renderLikeMarkdown(state, config) {
  const like = state.actions.like;
  const avg = like.timing.averageMs == null ? 'N/A' : `${like.timing.averageMs} ms`;
  const max = like.timing.maximumMs == null ? 'N/A' : `${like.timing.maximumMs} ms`;
  const lines = [
    '# Playwright Like Stress Test', '',
    `- **Final application status:** ${state.finalStatus}`,
    `- **Target URL:** ${state.targetUrl}`,
    `- **Started:** ${state.startedAt}`,
    `- **Finished:** ${state.finishedAt || 'Not finished'}`,
    `- **Total execution time:** ${(state.executionTimeMs / 1000).toFixed(2)} seconds`,
    `- **Overall interactions:** ${like.successful}/${like.requested} verified`,
    '', '## Interaction results', '',
    '| Metric | Like |', '|---|---:|',
    `| Requested | ${like.requested} |`,
    `| Successful | ${like.successful} |`,
    `| Failed | ${like.failed} |`,
    `| Skipped / not run | ${like.skipped} |`,
    `| Status | ${like.status} |`,
    `| Average response time | ${avg} |`,
    `| Maximum response time | ${max} |`,
    '', '## Stability metrics', '',
    `- JavaScript page errors: ${state.jsErrors.length}`,
    `- Console errors: ${state.consoleErrors.length} (fatal on console error: ${config.failOnConsoleError ? 'yes' : 'no'})`,
    `- Failed network requests: ${state.failedRequests.length}`,
    `- HTTP 4xx/5xx responses: ${state.httpErrorResponses.length}`,
    `- Telemetry HTTP 429 responses (recorded, non-fatal): ${state.telemetryRateLimits.length}`,
    `- Browser/page crashes or disconnects: ${state.browserCrashes.length}`,
    `- Unexpected same-site navigations: ${state.unexpectedNavigations.length}`,
    `- Dialogs observed: ${state.dialogs.length}`,
    `- Popups observed: ${state.popups}`,
    `- Live activity events recorded: ${(state.activityLog || []).length}`,
    '', '## Preflight inspection', '',
    `- Navigation succeeded: ${state.navigation.succeeded}`,
    `- HTTP status: ${state.navigation.status == null ? 'N/A' : state.navigation.status}`,
    `- Like disposition: ${state.inspection?.like?.disposition?.reason || (state.inspection?.like?.disposition?.runnable ? 'Runnable control' : 'Not inspected')}`,
    '', '## Run notes', ''
  ];
  if (!state.notes.length) lines.push('None.');
  else state.notes.forEach(note => lines.push(`- ${note}`));
  lines.push('', '## Stop reason', '', state.stopReason || 'None', '', '## Error details', '');
  if (!state.errors.length) lines.push('No interaction errors were recorded.');
  else {
    state.errors.forEach((error, index) => {
      lines.push(`${index + 1}. **${error.action} iteration ${error.iteration}** — ${error.timestamp}`, `   - ${error.message}`, `   - URL: ${error.url || 'N/A'}`, `   - Screenshot: ${error.screenshot || error.screenshotError || 'Not captured'}`);
    });
  }
  lines.push('', '## Supporting files', '', '- `report-like.json`: complete machine-readable run data', '- `activity.log`: readable live-action log', '- `activity.json`: structured activity events', '- `errors-like.json`: interaction errors and screenshot paths', '- `preflight-like.json`: accessible-control and DOM inventory', '- `playwright-results.json`: Playwright runner output', '- `artifacts/failures/`: screenshots captured on interaction failures', '');
  return lines.join('\n');
}

module.exports = { finalizeReport, finalizeCommentReport, finalizeLikeReport, renderActivityLog };


