// Where the e2e suite's two API processes live, shared by playwright.config.ts
// and by the specs that need to address one directly.
//
// Not a *.spec.ts file, so Playwright's default testMatch leaves it alone.
import { ports } from '../../../scripts/ports.mjs';

const { api: API_PORT } = ports();

export { API_PORT };

/** The API the bundle is built against, and the one every other spec uses. */
export const API_URL = `http://127.0.0.1:${API_PORT}`;

/**
 * A second API process, started with a rate limit small enough to cross on
 * purpose, so a test can get a real 429 in a real browser.
 *
 * It is a separate server rather than a smaller limit on the shared one
 * because the limiter counts per caller, not per test: lowering
 * API_RATE_LIMIT on the main API would have every other spec racing the same
 * budget and failing at random. This one exists to be exhausted, and nothing
 * else talks to it.
 *
 * The port is derived from the e2e API port and offset past it. `ports()`
 * hands out 8200-8399 for the API and 8600-8799 for the web server, so +200
 * lands in the gap between the two ranges and two worktrees still cannot
 * collide. E2E_LIMITED_API_PORT overrides, as the other two ports do.
 */
export const LIMITED_API_PORT = Number(process.env['E2E_LIMITED_API_PORT']) || API_PORT + 200;

export const LIMITED_API_URL = `http://127.0.0.1:${LIMITED_API_PORT}`;

/**
 * Small enough that a burst crosses it in well under a second, large enough
 * that the test sees allowed responses before the refused one.
 */
export const LIMITED_RATE_LIMIT = '5/minute';
