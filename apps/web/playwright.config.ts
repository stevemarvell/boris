import { defineConfig, devices } from '@playwright/test';
import {
  API_PORT,
  API_URL,
  LIMITED_API_PORT,
  LIMITED_API_URL,
  LIMITED_RATE_LIMIT,
  WEB_PORT,
} from './e2e/api-servers';

// Every port comes from e2e/api-servers.ts, derived from the worktree
// directory so parallel agents do not collide (E2E_API_PORT / E2E_WEB_PORT
// override). One list of servers, read here and by the specs alike.

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
      // The same variable CLAUDE.md's "Running it" sets by hand, for the same
      // reason: a developer's API is a development API. It restores the
      // GraphiQL IDE, schema introspection, and the manual's query console —
      // all three off by default so a forgotten variable fails closed.
      env: { API_ENVIRONMENT: 'development' },
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
    {
      // A second API, identical but for one service variable: a rate limit
      // small enough to cross deliberately. cors-expose-headers.spec.ts bursts
      // at it from inside the browser to get a real cross-origin 429 and read
      // Retry-After off it — the check that issue #89 turned on, because curl
      // and TestClient both lack the CORS layer that was eating the header.
      //
      // Its own process so the burst cannot spend the budget the rest of the
      // suite shares; see e2e/api-servers.ts.
      command: `uv run --directory ../api uvicorn api.main:app --host 127.0.0.1 --port ${LIMITED_API_PORT}`,
      url: `${LIMITED_API_URL}/health`,
      env: { API_ENVIRONMENT: 'development', API_RATE_LIMIT: LIMITED_RATE_LIMIT },
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
