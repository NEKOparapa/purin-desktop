import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results/playwright',
  testMatch: '**/*.spec.ts',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    channel: 'chrome',
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: 'npm run dev:web',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
  },
})
