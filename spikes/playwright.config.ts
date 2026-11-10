import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'harness/e2e',
  projects: [{ name: 'chromium' }],
  webServer: [],
});
