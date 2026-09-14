import { expect, test } from '@playwright/test';

test.describe('the whole family tree', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('person').first()).toBeVisible();
  });

  test('renders four generations and every person', async ({ page }) => {
    await expect(page.getByTestId('generation')).toHaveCount(4);
    await expect(page.getByTestId('person')).toHaveCount(44);
  });

  test('groups people into the right generations', async ({ page }) => {
    const groups = page.getByTestId('generation');
    await expect(groups.nth(0).getByTestId('person')).toHaveCount(8);
    await expect(groups.nth(1).getByTestId('person')).toHaveCount(15);
    await expect(groups.nth(2).getByTestId('person')).toHaveCount(16);
    await expect(groups.nth(3).getByTestId('person')).toHaveCount(5);
  });

  test('shows relationships that are derived, not stored', async ({ page }) => {
    const fred = page.locator('[data-person-id="fred-shaw"]');
    await expect(fred).toContainText('Ellie Shaw');
    await expect(fred).toContainText('Sally Baker');
    await expect(fred).toContainText('Daisy Shaw, Sam Shaw');
    await expect(fred).toContainText('Frank Shaw, Margaret Shaw');
  });

  test('places someone who married in beside their spouse', async ({ page }) => {
    const generation = page.getByTestId('generation').nth(2);
    await expect(generation.locator('[data-person-id="tom-baker"]')).toBeVisible();
    await expect(generation.locator('[data-person-id="sally-baker"]')).toBeVisible();
  });

  test('renders the zero cases without breaking', async ({ page }) => {
    // Nora never married and has no children, but she does have parents and
    // siblings — only the relationships she lacks should be absent.
    const nora = page.locator('[data-person-id="nora-pike"]');
    await expect(nora).toContainText('Dorothy Pike, Douglas Pike');
    await expect(nora).not.toContainText('married to');
    await expect(nora).not.toContainText('children');

    // Married, no children.
    const olivia = page.locator('[data-person-id="olivia-vance"]');
    await expect(olivia).toContainText('Peter Vance');
    await expect(olivia).not.toContainText('children');

    // Oldest generation: no parents and no siblings recorded.
    const albert = page.locator('[data-person-id="albert-shaw"]');
    await expect(albert).toContainText('Agnes Shaw');
    await expect(albert).not.toContainText('parents');
    await expect(albert).not.toContainText('siblings');

    // An only child.
    await expect(page.locator('[data-person-id="hugo-shaw"]')).not.toContainText('siblings');
  });
});

test('person cards carry the padding that separates them', async ({ page }) => {
  await page.goto('/');
  const fred = page.locator('[data-person-id="fred-shaw"]');
  await expect(fred).toBeVisible();

  // Ionic pads through custom properties on the host, so read those rather
  // than computed padding, which lands on a shadow-DOM child. Compare the
  // number, not the string: the production build minifies 0.7rem to .7rem.
  const padding = await fred.evaluate((node) => ({
    top: getComputedStyle(node).getPropertyValue('--padding-top').trim(),
    bottom: getComputedStyle(node).getPropertyValue('--padding-bottom').trim(),
  }));
  expect(padding.top).toMatch(/rem$/);
  expect(parseFloat(padding.top)).toBeCloseTo(0.7);
  expect(parseFloat(padding.bottom)).toBeCloseTo(0.7);
});

test.describe('filtering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('person').first()).toBeVisible();
  });

  test('narrows the tree to matching people', async ({ page }) => {
    await page.getByTestId('filter').locator('input').fill('pike');
    await expect(page.getByTestId('match-count')).toContainText('of 44 people');
    const shown = await page.getByTestId('person').count();
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(44);
    await expect(page.locator('[data-person-id="fred-shaw"]')).toHaveCount(0);
  });

  test('drops generations that have nobody left', async ({ page }) => {
    await page.getByTestId('filter').locator('input').fill('daisy');
    await expect(page.getByTestId('person')).toHaveCount(1);
    await expect(page.getByTestId('generation')).toHaveCount(1);
  });

  test('says so when nobody matches, and recovers when cleared', async ({ page }) => {
    const input = page.getByTestId('filter').locator('input');
    await input.fill('zzzzz');
    await expect(page.getByTestId('no-matches')).toBeVisible();
    await expect(page.getByTestId('person')).toHaveCount(0);

    await input.fill('');
    await expect(page.getByTestId('person')).toHaveCount(44);
  });
});

test('shows an error rather than a blank page when the API is unreachable', async ({ page }) => {
  await page.route('**/graphql', (route) => route.abort('failed'));
  await page.goto('/');
  await expect(page.getByTestId('error')).toBeVisible();
  await expect(page.getByTestId('retry')).toBeVisible();
  await expect(page.getByTestId('person')).toHaveCount(0);
});

test('recovers from a request that never comes back', async ({ page }) => {
  // The cold start this closes: Railway's `sleepApplication` means the first
  // request wakes a sleeping container and the browser is left holding an open
  // socket. `route.abort` cannot stand in for that — it produces a prompt
  // rejection, which the client has always handled. The only way to reach the
  // hang is to accept the request and never answer it.
  //
  // The clock here is real: the client's timeout is thirty seconds and this
  // test genuinely waits it out against the built bundle, which is the point.
  test.setTimeout(120_000);

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  let seen = 0;
  await page.route('**/graphql', async (route) => {
    seen += 1;
    if (seen > 1) {
      // The container is awake now, exactly as it would be in production. Held
      // back a couple of seconds so the "still waiting" line is observable: a
      // local API answers the second attempt in milliseconds, which is too
      // short a window for a poll to catch.
      await sleep(2_000);
      await route.continue();
      return;
    }
    // Hang past the client's deadline, then answer into a socket nobody is
    // listening on any more.
    await sleep(40_000);
    await route.fulfill({ status: 504, body: 'too late' }).catch(() => {});
  });

  await page.goto('/');
  await expect(page.getByTestId('loading')).toBeVisible();
  // The user is told the wait is a wake, not a stall.
  await expect(page.getByTestId('waking')).toBeVisible({ timeout: 60_000 });
  // And the automatic second attempt gets the tree, with no click required.
  await expect(page.getByTestId('person').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('person')).toHaveCount(44);
  expect(seen).toBeGreaterThanOrEqual(2);
});
