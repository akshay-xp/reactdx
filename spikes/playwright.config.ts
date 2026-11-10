import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  projects: [{ name: 'chromium' }],
  webServer: [
    { command: 'pnpm dev:18', url: 'http://localhost:5118', reuseExistingServer: true },
    { command: 'pnpm dev:19', url: 'http://localhost:5119', reuseExistingServer: true },
    { command: 'pnpm dev:next', url: 'http://localhost:5120', reuseExistingServer: true },
  ],
});
