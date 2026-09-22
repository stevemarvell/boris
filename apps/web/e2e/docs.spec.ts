import { expect, test } from '@playwright/test';

// These run against the built bundle, which is the point: the docs are
// produced by a prebuild step and copied in by Vite, so nothing but a real
// build proves they reach the deployment. The failure this guards against —
// documentation that exists in the repository and nowhere on the web — is
// exactly the one that losing GitHub Pages caused.
test.describe('the docs Vercel serves', () => {
  test('lists every document at /docs/', async ({ page }) => {
    await page.goto('/docs/');
    await expect(page.getByRole('heading', { name: 'boris docs' })).toBeVisible();

    for (const name of [
      'Steps of AI Adoption',
      'Data governance',
      'Standard operating procedures',
      'Extracting the baseline',
      'Web app manual',
      'API manual',
    ]) {
      await expect(page.getByRole('link', { name })).toBeVisible();
    }
  });

  test('renders the adoption document, not its Markdown', async ({ page }) => {
    await page.goto('/docs/adoption.html');
    await expect(page.getByRole('heading', { name: 'Steps of AI Adoption' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '0: Gated' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('**');
  });

  test('publishes the data governance decision', async ({ page }) => {
    // The decision is only a decision if someone who has never seen this
    // repository can read it, so it has to reach the deployment.
    await page.goto('/docs/data-governance.html');
    await expect(page.getByRole('heading', { name: 'Data governance' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'The trigger to revisit' })).toBeVisible();
    await expect(page.locator('body')).toContainText('invented');
  });

  test('publishes the operating procedures', async ({ page }) => {
    // An SOP nobody can find is a convention. The declared ceilings are the
    // part worth reaching the deployment, since they are what an agent is
    // expected to obey.
    await page.goto('/docs/sops.html');
    await expect(page.getByRole('heading', { name: 'Standard operating procedures' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'SOP 1: Every loop declares a maximum' }),
    ).toBeVisible();
    await expect(page.locator('table').first()).toBeVisible();

    // The ranking words, for the same reason as the ceilings: an agent is
    // expected to use these three and no others, and a scale nobody can look
    // up is a scale everyone re-invents — which is the thing SOP 5 stops.
    //
    // All three, and against SOP 5's own table rather than the page: the first
    // version asserted two of them on `body`, so dropping the `high` row would
    // have left this green, and either of the other two would have passed on
    // the word appearing in a sentence elsewhere. A test for "the scale
    // reaches the deployment" has to fail when a row leaves it.
    const sop5 = page.getByRole('heading', { name: 'SOP 5: One scale ranks everything' });
    await expect(sop5).toBeVisible();

    // The table *after that heading*, not the last one on the page. Document
    // position would tie this to SOP 5 only until a SOP 6 with a table of its
    // own is appended, at which point it would quietly assert against the
    // wrong table rather than failing.
    const scale = sop5.locator('xpath=following::table[1]');
    for (const rank of ['critical', 'high', 'medium']) {
      await expect(scale).toContainText(rank);
    }

    // SOP 6 is the one an agent is most likely to act on without reading, so
    // it is the one most worth proving is readable by someone who has not.
    // (It also now follows SOP 5, which is why the locator above stopped
    // being `table.last()`.)
    await expect(
      page.getByRole('heading', { name: 'SOP 6: Decide and act; report after' }),
    ).toBeVisible();
    await expect(page.locator('body')).toContainText('recoverability, not scope');

    // SOP 7 names two files, and the whole rule is which of them is reviewed.
    // A published copy missing the untracked one would read as advice about a
    // single file, which is the opposite of what it says.
    await expect(
      page.getByRole('heading', { name: 'SOP 7: An approval belongs where it can be reviewed' }),
    ).toBeVisible();
    for (const file of ['.claude/settings.json', '.claude/settings.local.json']) {
      await expect(page.locator('body')).toContainText(file);
    }
  });

  test('publishes the extraction report', async ({ page }) => {
    // The report exists to be read when starting the *next* project, which by
    // definition is from outside this checkout. Rendering locally is not the
    // claim; reaching the deployment is.
    await page.goto('/docs/extraction.html');
    await expect(page.getByRole('heading', { name: 'Extracting the baseline' })).toBeVisible();

    // The section that stops a reader copying this project's security verdict
    // onto a project with real data. It is the one part of the report that is
    // dangerous to lose, so it is the part asserted.
    await expect(
      page.getByRole('heading', { name: 'What must not be inherited' }),
    ).toBeVisible();
    await expect(page.locator('body')).toContainText('Do not take the verdict.');
    await expect(page.locator('body')).not.toContainText('**');
  });

  test('serves the web manual with its screenshots', async ({ page }) => {
    const response = await page.goto('/docs/manual/web/');
    expect(response?.status()).toBe(200);

    const shot = page.locator('img[src="screenshot-list.jpg"]').first();
    await expect(shot).toBeVisible();
    // A broken <img> is still "visible" to Playwright; the decoded width is
    // what says the file actually arrived.
    expect(await shot.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  });

  test('still publishes the step-0 page as it was', async ({ page }) => {
    await page.goto('/docs/step-0.html');
    await expect(page.getByRole('heading', { name: 'Hello, world' })).toBeVisible();
  });

  test('links the API manual at the API this build points at', async ({ page }) => {
    // The e2e suite sets VITE_API_URL, so the docs must follow it there rather
    // than to production — the same rule the bundle obeys.
    await page.goto('/docs/');
    const href = await page.getByRole('link', { name: 'API manual' }).getAttribute('href');
    expect(href).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
  });
});

test.describe('the manual the API serves itself', () => {
  test('opens at the root of the API, and its console queries that API', async ({ page }) => {
    // Against the real uvicorn, not the bundle: this is the half of the docs
    // that ships inside the API image rather than to Vercel.
    await page.goto('/docs/');
    const href = await page.getByRole('link', { name: 'API manual' }).getAttribute('href');
    const response = await page.goto(href ?? '/');
    expect(response?.status()).toBe(200);

    await expect(page.getByRole('heading', { name: 'Family Tree API' })).toBeVisible();
    // Same-origin, so the endpoint strip names the API it was loaded from.
    await expect(page.locator('.endpoint-strip')).toContainText(new URL(href ?? '').origin);

    await page.getByRole('button', { name: 'Liveness' }).click();
    await page.getByRole('button', { name: 'Run query' }).click();
    await expect(page.locator('#response')).toContainText('"status": "ok"');
  });

  test('does not shadow the endpoints it sits beside', async ({ page, request }) => {
    // The mount at "/" is a catch-all; /health has to keep winning it.
    await page.goto('/docs/');
    const href = await page.getByRole('link', { name: 'API manual' }).getAttribute('href');
    const health = await request.get(new URL('/health', href ?? '').href);

    expect(health.ok()).toBe(true);
    expect((await health.json())['ok']).toBe(true);
  });
});
