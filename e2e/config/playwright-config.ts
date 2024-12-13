import * as path from 'path';

import { defineConfig } from '@playwright/test';

const outputDir = path.join(__dirname, '..', 'e2e', 'test-results');
const testDir = path.join(__dirname, '..', '..', 'e2e');
// The provisioned GitHub runners are slow, so allow 2 hours for a full e2e run.
const timeScale = process.env.CI ? 4 : 1;

export default defineConfig({
  testDir,
  outputDir,
  timeout:       10 * 60 * 1000 * timeScale,
  globalTimeout: 30 * 60 * 1000 * timeScale,
  workers:       1,
  reporter:      [['list', { printSteps: !!process.env.CI }]],
});
