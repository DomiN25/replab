import { defineConfig, devices } from '@playwright/test';

// Nutzt das installierte Microsoft Edge (kein Browser-Download nötig).
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5180', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev -- --port 5180 --strictPort',
    url: 'http://localhost:5180',
    reuseExistingServer: false,
    timeout: 90_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Edge'], channel: 'msedge' }, testIgnore: /training/ },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: 'msedge' }, testMatch: /training/ },
  ],
});
