const { defineConfig } = require('@playwright/test');
const fs = require('node:fs');
fs.mkdirSync('reports', { recursive: true });
const config = require('./stress.config');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 0,
  expect: { timeout: config.stateTimeoutMs },
  reporter: [['list'], ['json', { outputFile: 'reports/playwright-results.json' }]],
  outputDir: 'test-results',
  use: {
    browserName: 'chromium',
    headless: config.headless,
    actionTimeout: config.actionTimeoutMs,
    navigationTimeout: config.navigationTimeoutMs,
    trace: process.env.PLAYWRIGHT_TRACE || 'off',
    screenshot: 'off',
    video: 'off'
  }
});
