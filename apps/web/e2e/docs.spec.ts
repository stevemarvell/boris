import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// The deployment's title comes from project.json, not a hardcoded name — so
// this reads the same manifest the build does, rather than asserting a
// literal string that would drift the moment that name changes.
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { name: PROJECT_NAME } = JSON.parse(readFileSync(join(PROJECT_ROOT, 'project.json'), 'utf8'));

// These run against the built bundle, which is the point: the docs are
// produced by a prebuild step and copied in by Vite, so nothing but a real
// build proves they reach the deployment. The failure this guards against —
// documentation that exists in the repository and nowhere on the web — is
// exactly the one that losing GitHub Pages caused.
test.describe('the docs Vercel serves', () => {
  test('lists every document at /docs/', async ({ page }) => {
    await page.goto('/docs/');
    await expect(page.getByRole('heading', { name: `${PROJECT_NAME} docs` })).toBeVisible();

    for (const name of [
      'Steps of AI Adoption',
      'Data governance',
      'Standard operating procedures',
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

  test('still publishes the step-0 page as it was', async ({ page }) => {
    await page.goto('/docs/step-0.html');
    await expect(page.getByRole('heading', { name: 'Hello, world' })).toBeVisible();
  });
});
