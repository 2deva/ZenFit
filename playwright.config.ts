import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', workers: 1,
  use: { baseURL: 'http://127.0.0.1:5174', trace: 'retain-on-failure' },
  webServer: { command: 'npm run demo', url: 'http://127.0.0.1:5174/api/evaluation/health', timeout: 60000, reuseExistingServer: !process.env.CI },
});
