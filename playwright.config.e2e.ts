import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // E2E 测试顺序执行
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // E2E 测试单线程
  reporter: [
    ['html', { outputFolder: 'e2e-report' }],
    ['json', { outputFile: 'e2e-results.json' }],
    ['list']
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5173',
    trace: 'on',
    screenshot: 'on',
    video: 'on'
  },

  projects: [
    {
      name: 'e2e-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  timeout: 60000, // E2E 测试超时 60 秒
});
