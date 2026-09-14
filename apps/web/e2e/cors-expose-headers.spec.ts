// The check issue #89 says is the only one that would have caught it.
//
// The bug was that CORSMiddleware never set `expose_headers`, so a browser
// stripped Retry-After, Content-Location and the X-RateLimit-* headers out of
// every cross-origin response before JavaScript could read them. The server
// sent all of them the whole time — which is why every verification anyone had
// done said it was fine. curl has no CORS. `TestClient` has no CORS. Neither
// can tell a header that arrives from one the page is allowed to read.
//
// A browser can. These tests run inside the page, at the page's own origin,
// against an API on a different port, so the browser's CORS layer sits in the
// path exactly as it does between Vercel and Railway. `page.evaluate` is what
// puts them there: Playwright's `request` fixture and `page.route` both run in
// Node, outside the browser, and would have passed against the broken code.
import { expect, test, type Page } from '@playwright/test';
import { API_URL, LIMITED_API_URL } from './api-servers';

/** The cheapest query the schema answers, so a burst measures the limiter. */
const QUERY = { query: '{ status }' };

/** Somebody who is in data/family.json; the identity /me answers as. */
const PERSON = 'fred-shaw';

/** A bounded burst. An unbounded one is what the limiter exists to refuse. */
const MAX_ATTEMPTS = 20;

interface BrowserResponse {
  readonly status: number;
  /** Only the headers the browser was willing to hand the page. */
  readonly headers: Record<string, string>;
}

/**
 * Run a fetch inside the page and report what the *browser* let it see.
 *
 * The headers come from `response.headers` in page context, which is the
 * post-CORS view: anything Access-Control-Expose-Headers does not name is
 * simply not in there. `repeatUntilStatus` retries the same request until the
 * server answers with that status, which is how the rate limit gets crossed.
 */
async function fetchFromPage(
  page: Page,
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
  repeatUntilStatus: number | null = null,
): Promise<BrowserResponse> {
  return page.evaluate(
    async (args) => {
      const attempts = args.until === null ? 1 : args.maxAttempts;
      let response = await fetch(args.url, args.init);
      for (let n = 1; n < attempts && response.status !== args.until; n += 1) {
        response = await fetch(args.url, args.init);
      }
      const headers: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        headers[name] = value;
      });
      return { status: response.status, headers };
    },
    { url, init, until: repeatUntilStatus, maxAttempts: MAX_ATTEMPTS },
  );
}

/** Read a header as a string, so an absent one fails an assertion rather than a type. */
function header(response: BrowserResponse, name: string): string {
  return response.headers[name] ?? '';
}

test.describe('what a cross-origin browser is allowed to read', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('person').first()).toBeVisible();
  });

  test('the premise: the page and the APIs are different origins', async ({ page }) => {
    // If these ever became the same origin, CORS would drop out of the path
    // and every assertion below would pass while proving nothing.
    const origin = await page.evaluate(() => window.location.origin);
    expect(origin).not.toBe(API_URL);
    expect(origin).not.toBe(LIMITED_API_URL);
  });

  test('a 429 hands the page its Retry-After and its rate-limit budget', async ({
    page,
    request,
  }) => {
    const refused = await fetchFromPage(
      page,
      `${LIMITED_API_URL}/graphql`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(QUERY),
      },
      429,
    );

    expect(refused.status, `no 429 within ${MAX_ATTEMPTS} attempts`).toBe(429);

    // The assertion the issue asks for. Before `expose_headers` this was the
    // empty string — the header was on the wire and the browser removed it, so
    // apps/web/src/api.ts fell back to a guess on every 429 in production.
    expect(header(refused, 'retry-after'), 'the browser could not read Retry-After').not.toBe('');
    expect(Number(header(refused, 'retry-after'))).toBeGreaterThan(0);

    // api.limits sets headers_enabled=True to "tell a well-behaved client what
    // its budget is". This is the client, and this is it being told.
    expect(header(refused, 'x-ratelimit-limit')).not.toBe('');
    expect(header(refused, 'x-ratelimit-remaining')).toBe('0');
    expect(header(refused, 'x-ratelimit-reset')).not.toBe('');

    // And the contrast that names the layer responsible. `request` is Node: no
    // CORS, no stripping. It could read Retry-After off this same endpoint
    // before the fix too, which is precisely why curl-shaped checks kept
    // passing. The budget is already spent, so this costs nothing.
    const direct = await request.post(`${LIMITED_API_URL}/graphql`, { data: QUERY });
    expect(direct.status()).toBe(429);
    expect(direct.headers()['retry-after']).toBeTruthy();
  });

  test('a 200 from /me hands the page the Content-Location it sets', async ({ page }) => {
    // Against the main API rather than the limited one: this is the ordinary
    // path, and it also exercises the x-person-id preflight, which only a
    // browser sends.
    const me = await fetchFromPage(page, `${API_URL}/me`, {
      method: 'GET',
      headers: { 'x-person-id': PERSON },
    });

    expect(me.status).toBe(200);
    expect(header(me, 'content-location')).toContain(`/person/${PERSON}`);
    // Cache-Control comes through either way — it is CORS-safelisted, which is
    // luck rather than design, and is why the rest of this file exists.
    expect(header(me, 'cache-control')).toContain('no-store');
  });
});
