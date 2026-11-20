# Playwright Like / Share Stress Test

A sequential UI stress-test project for the LANGTAD dashboard. It uses Playwright accessible locators, performs real browser clicks, verifies observable UI behavior, monitors browser/network health, and writes JSON plus Markdown reports.

## Click and external-navigation behavior

The test performs ordinary Playwright clicks on the visible Like and Share controls. If a click opens an external page (including YouTube) in a new tab, the runner waits briefly for the destination URL, records it, closes that tab, and continues on the dashboard. If the click redirects the current tab instead, the runner records the destination and uses browser Back to return to the dashboard before the next click.

For this target, preflight found Like as an anchor linking to a YouTube video. The test now clicks that link and exits YouTube; it does **not** click YouTube's own Like control or prove that a YouTube Like was registered. It verifies the dashboard link click and the return to the dashboard. If a local Like toggle button is present instead, the test verifies its pressed/liked state change.

The Share control is clicked normally. Native `navigator.share` and clipboard calls are instrumented with safe test doubles so the run does not publish/send content or write to a real clipboard. `window.open` is instrumented while retaining normal browser behavior, so any external popup is genuinely opened, observed, then closed by the runner. In-page share dialogs/menus are closed before continuing. External top-level navigations are no longer blocked; they are immediately exited after the destination is observed.

The test does not call backend APIs to simulate clicks or bypass application rate limits. It treats HTTP 429 from the specifically identified telemetry endpoint (`/__l5e/trackevents`) differently from application/API rate limits: telemetry 429 responses are recorded, followed by a cooldown, and the run continues unless the configured telemetry-429 safety threshold is reached. HTTP 429 from other endpoints, HTTP 5xx, same-origin XHR/fetch request failures, page crashes, and uncertain click outcomes remain stop conditions. Console errors are recorded as diagnostics but are non-fatal by default; set `FAIL_ON_CONSOLE_ERROR=true` to make them fatal.

## Requirements

- Node.js 18 or newer (Node.js 20+ recommended)
- npm
- Chromium installed by Playwright

## Install

```bash
npm install
npx playwright install chromium
```

## Configure

The project intentionally has no runtime dotenv dependency; `.env.example` is a reference template. Export variables in your shell before running. Example for macOS/Linux:

```bash
export TARGET_URL="https://cb3newsmonitoringdashboard.lovable.app/lokal/langtad"
export LIKE_CLICKS=1000
export SHARE_CLICKS=1000
export DELAY_BETWEEN_CLICKS_MS=2000
export BATCH_SIZE=25
export BATCH_COOLDOWN_MS=10000
export TELEMETRY_429_BACKOFF_MS=30000
export MAX_TELEMETRY_429=5
export EXTERNAL_NAVIGATION_TIMEOUT_MS=10000
export EXTERNAL_NAVIGATION_DETECT_MS=500
export FAIL_ON_CONSOLE_ERROR=false
export NAVIGATION_TIMEOUT_MS=30000
export ACTION_TIMEOUT_MS=10000
export MAX_CONSECUTIVE_FAILURES=3
```

Windows PowerShell uses `$env:LIKE_CLICKS = "1000"` syntax.

All supported settings:

| Variable | Default | Purpose |
|---|---:|---|
| `TARGET_URL` | target dashboard URL | Page to test |
| `LIKE_CLICKS` | `1000` | Requested Like clicks |
| `SHARE_CLICKS` | `1000` | Requested Share clicks |
| `DELAY_BETWEEN_CLICKS_MS` | `2000` | Delay after each successful interaction inside a batch |
| `BATCH_SIZE` | `25` | Interactions per batch |
| `BATCH_COOLDOWN_MS` | `10000` | Cooldown between batches and after safe pre-click failures |
| `TELEMETRY_429_PATHS` | `/__l5e/trackevents` | Comma-separated URL path fragments classified as telemetry for HTTP 429 only |
| `TELEMETRY_429_BACKOFF_MS` | `30000` | Pause after a telemetry-only HTTP 429 before the next interaction |
| `MAX_TELEMETRY_429` | `5` | Stop after this many telemetry HTTP 429 responses to avoid hammering a throttled endpoint |
| `FAIL_ON_CONSOLE_ERROR` | `false` | When true, any browser console error makes the final test status Failed |
| `NAVIGATION_TIMEOUT_MS` | `30000` | Initial navigation timeout |
| `ACTION_TIMEOUT_MS` | `10000` | Locator visibility/click timeout |
| `EXTERNAL_NAVIGATION_TIMEOUT_MS` | `10000` | Maximum wait for an external destination to load or for the dashboard to be restored |
| `EXTERNAL_NAVIGATION_DETECT_MS` | `500` | Brief wait after each click to detect a new destination tab or same-tab redirect |
| `STATE_TIMEOUT_MS` | `5000` | Time allowed for Like state verification |
| `RESPONSIVE_TIMEOUT_MS` | `5000` | Time to wait for the page/control to become responsive |
| `MAX_CONSECUTIVE_FAILURES` | `3` | Consecutive failures allowed before stopping pre-click recovery |
| `SCREENSHOT_MAX_COUNT` | `20` | Maximum failure screenshots to save |
| `HEADLESS` | `true` | Run Chromium headless or headed |

## Run

```bash
npm run stress
```

The test is intentionally sequential: one browser, one page, one worker, no retries. A click whose outcome is uncertain is **not** repeated, because retrying a toggle/share action may duplicate or reverse a real operation.

To run a short smoke test first:

```bash
LIKE_CLICKS=0 SHARE_CLICKS=2 BATCH_SIZE=2 BATCH_COOLDOWN_MS=1000 npm run stress
```

## Live console progress

While the test runs, the terminal prints each Like/Share attempt with its iteration number, status (`CLICKING`, `SUCCESS`, `FAILED`, or `SKIPPED`), the destination/exit method when relevant, verification evidence for Share, elapsed time, and running success/failure/skipped totals. Example:

```text
[2026-11-19T15:30:00.000Z] [LIKE] [1/1000] [CLICKING] destination=https://www.youtube.com/watch?v=... | success=0, failed=0, skipped=0
[2026-11-19T15:30:00.650Z] [LIKE] [1/1000] [SUCCESS] destination=https://www.youtube.com/watch?v=... | exitMethod=popup_closed | returnedToDashboard=true | durationMs=650 | success=1, failed=0, skipped=0
[2026-11-19T15:30:01.000Z] [SHARE] [1/1000] [SUCCESS] verifiedBy=clipboard write attempted | durationMs=120 | success=1, failed=0, skipped=0
```

The same event stream is saved in `reports/activity.log` and `reports/activity.json`; `reports/report.json` also contains the `activityLog` array.

## Results

Run the offline monitor/reporting checks with `npm run test:unit`. After a run, review:

- `reports/preflight.json` — inspected accessible control names, tag/role, `href`, state attributes, and a compact control inventory. The Like disposition explains whether it will be treated as a local toggle or a navigation link.
- `reports/report.json` — complete test results and stability metrics.
- `reports/activity.log` — readable per-click progress log.
- `reports/activity.json` — structured per-click activity events.
- `reports/summary.md` — human-readable summary.
- `reports/errors.json` — interaction/setup failures.
- `reports/playwright-results.json` — Playwright runner output.
- `artifacts/failures/` — screenshots captured when an interaction fails.
- `test-results/` — Playwright traces and runner artifacts.

The final status has three possible values:

- **Passed:** all requested Like and Share interactions were verified and no fatal stability errors were observed.
- **Failed:** an interaction failed, the app/browser crashed, or fatal application/network errors were observed.
- **Incomplete:** navigation/preflight/control safety prevented completion, or the test stopped before all requested interactions completed without a confirmed app failure.

A Like anchor to YouTube is treated as a navigation action: each click is counted when the destination is observed and the runner returns to the dashboard. This does not register a Like on YouTube itself; it only tests the dashboard link and safe return. Use `LIKE_CLICKS=0` for Share-only runs.

## Notes / limitations

1. The exact DOM and accessibility metadata must be confirmed by the preflight report generated on your machine. The remote page text alone is not a substitute for a live DOM inspection.
2. Native OS share-sheet rendering is deliberately not launched. The report records whether the Share click called `navigator.share`, attempted clipboard writing, invoked `window.open`, or opened an in-page dialog/menu.
3. All HTTP 4xx/5xx responses are logged. A 429 from the configured telemetry path is classified separately, triggers a cooldown, and is non-fatal until `MAX_TELEMETRY_429` is reached. A 429 from any other endpoint and any 5xx response stop the run. Other 4xx responses are reported but do not automatically stop the run.
4. The default delay was increased to 2 seconds and the batch size reduced to 25 to lower pressure on the site. The test remains sequential. Do not lower delays or raise request counts unless the application owner has approved the test window and load.
5. The current Like control points to a YouTube video. The runner opens that destination and exits it (closes the popup or uses browser Back) on every iteration. It does not interact with YouTube controls or sign in to an account.
