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
  await expect(page.getByTestId('person')).toHaveCount(0);
});
