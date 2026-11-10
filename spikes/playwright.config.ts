import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'harness/e2e',
  projects: [{ name: 'chromium' }],
  webServer: [
    { command: 'pnpm dev:18', url: 'http://localhost:5118', reuseExistingServer: true },
  ],
});
