const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { clickAndExitDestination } = require('../../src/runner');

const dashboardUrl = 'https://cb3newsmonitoringdashboard.lovable.app/lokal/langtad';
const youtubeUrl = 'https://www.youtube.com/watch?v=VIxeHfO4WiE';
const config = { actionTimeoutMs: 1000, externalNavigationTimeoutMs: 1000, externalNavigationDetectMs: 0 };

class FakePopup {
  constructor(url) { this.currentUrl = url; this.wasClosed = false; }
  url() { return this.currentUrl; }
  async waitForURL(predicate) {
    assert.equal(predicate(new URL(this.currentUrl)), true);
  }
  async waitForLoadState() {}
  async close() { this.wasClosed = true; }
}

class FakePage extends EventEmitter {
  constructor(url) { super(); this.currentUrl = url; this.history = [url]; }
  url() { return this.currentUrl; }
  async waitForURL(predicate) {
    assert.equal(predicate(new URL(this.currentUrl)), true);
  }
  async waitForLoadState() {}
  async goBack() {
    this.currentUrl = this.history[0];
    return null;
  }
}

test('external popup is observed, closed, and the dashboard remains active', async () => {
  const page = new FakePage(dashboardUrl);
  const popup = new FakePopup(youtubeUrl);
  const state = { externalDestinationsExited: [] };
  const locator = {
    async click() { page.emit('popup', popup); }
  };

  const outcome = await clickAndExitDestination(page, locator, config, state, 'like', 1);

  assert.equal(outcome.navigated, true);
  assert.equal(outcome.exitMethod, 'popup_closed');
  assert.equal(popup.wasClosed, true);
  assert.equal(page.url(), dashboardUrl);
  assert.equal(state.externalDestinationsExited.length, 1);
  assert.equal(state.externalDestinationsExited[0].destinationUrl, youtubeUrl);
});

test('same-tab external redirect is exited with browser Back', async () => {
  const page = new FakePage(dashboardUrl);
  const state = { externalDestinationsExited: [] };
  const locator = {
    async click() {
      page.currentUrl = youtubeUrl;
      page.history.push(youtubeUrl);
    }
  };

  const outcome = await clickAndExitDestination(page, locator, config, state, 'share', 3);

  assert.equal(outcome.navigated, true);
  assert.equal(outcome.exitMethod, 'browser_back');
  assert.equal(outcome.destinationUrl, youtubeUrl);
  assert.equal(page.url(), dashboardUrl);
  assert.equal(state.externalDestinationsExited.length, 1);
});
