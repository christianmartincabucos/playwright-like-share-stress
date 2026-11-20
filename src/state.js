function createRunState(config) {
  const now = new Date().toISOString();
  return {
    startedAt: now,
    finishedAt: null,
    targetUrl: config.targetUrl,
    requested: { like: config.likeClicks, share: config.shareClicks, comment: config.commentClicks },
    actions: {
      like: createActionState(config.likeClicks),
      share: createActionState(config.shareClicks),
      comment: createActionState(config.commentClicks)
    },
    executionTimeMs: 0,
    navigation: { attempted: false, succeeded: false, status: null, error: null },
    inspection: null,
    jsErrors: [],
    consoleErrors: [],
    failedRequests: [],
    httpErrorResponses: [],
    telemetryRateLimits: [],
    telemetryCooldowns: [],
    browserCrashes: [],
    unexpectedNavigations: [],
    externalNavigations: [],
    externalDestinationsExited: [],
    dialogs: [],
    popups: 0,
    errors: [],
    activityLog: [],
    notes: [],
    stopReason: null,
    finalStatus: 'Incomplete'
  };
}

function createActionState(requested) {
  return {
    requested,
    successful: 0,
    failed: 0,
    skipped: 0,
    status: requested === 0 ? 'not_requested' : 'not_started',
    responseTimesMs: [],
    failureDetails: []
  };
}

function createLikeRunState(config) {
  const now = new Date().toISOString();
  return {
    startedAt: now,
    finishedAt: null,
    targetUrl: config.targetUrl,
    requested: { like: config.likeClicks },
    actions: {
      like: createActionState(config.likeClicks)
    },
    executionTimeMs: 0,
    navigation: { attempted: false, succeeded: false, status: null, error: null },
    inspection: null,
    jsErrors: [],
    consoleErrors: [],
    failedRequests: [],
    httpErrorResponses: [],
    telemetryRateLimits: [],
    telemetryCooldowns: [],
    browserCrashes: [],
    unexpectedNavigations: [],
    externalNavigations: [],
    externalDestinationsExited: [],
    dialogs: [],
    popups: 0,
    errors: [],
    activityLog: [],
    notes: [],
    stopReason: null,
    finalStatus: 'Incomplete'
  };
}

function createCommentRunState(config) {
  const now = new Date().toISOString();
  return {
    startedAt: now,
    finishedAt: null,
    targetUrl: config.targetUrl,
    requested: { comment: config.commentClicks },
    actions: {
      comment: createActionState(config.commentClicks)
    },
    executionTimeMs: 0,
    navigation: { attempted: false, succeeded: false, status: null, error: null },
    inspection: null,
    jsErrors: [],
    consoleErrors: [],
    failedRequests: [],
    httpErrorResponses: [],
    telemetryRateLimits: [],
    telemetryCooldowns: [],
    browserCrashes: [],
    unexpectedNavigations: [],
    externalNavigations: [],
    externalDestinationsExited: [],
    dialogs: [],
    popups: 0,
    errors: [],
    activityLog: [],
    notes: [],
    stopReason: null,
    finalStatus: 'Incomplete'
  };
}

module.exports = { createRunState, createLikeRunState, createCommentRunState };
