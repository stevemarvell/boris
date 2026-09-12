import { defineConfig, devices } from '@playwright/test';
import { ports } from '../../scripts/ports.mjs';

// Derived from the worktree directory so parallel agents do not collide.
// E2E_API_PORT / E2E_WEB_PORT override.
const { api: API_PORT, web: WEB_PORT } = ports();
const API_URL = `http://127.0.0.1:${API_PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: process.env['CI'] ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // The real API, not a mock: a schema change that breaks the client
      // should fail here rather than in production.
      command: `uv run --directory ../api uvicorn api.main:app --host 127.0.0.1 --port ${API_PORT}`,
      url: `${API_URL}/health`,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
    {
      // The built bundle, not the dev server, so build configuration is
      // exercised — that is where every deployment failure has come from.
      command: `npm run build && npx vite preview --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
      env: { VITE_API_URL: API_URL },
    },
  ],
});
