import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../../../scripts/markdown.mjs';
import { GOVERNANCE, isProse, reviewScope } from '../../../scripts/review-scope.mjs';

describe('reviewScope', () => {
  it('runs both reviews when anything but prose changed', () => {
    const scope = reviewScope(['apps/api/src/api/main.py', 'README.md']);
    expect(scope).toMatchObject({ code: true, security: true });
    expect(scope.why).toContain('apps/api/src/api/main.py');
  });

  it('skips both when every changed file is prose', () => {
    expect(reviewScope(['docs/adoption.md', 'README.md'])).toMatchObject({
      code: false,
      security: false,
    });
  });

  it('reviews a governance-only change for security but not for code', () => {
    // There is no code in that file, and the whole security posture is in it.
    expect(reviewScope([GOVERNANCE])).toMatchObject({ code: false, security: true });
  });

  it('does not treat the reviewers own rubrics as prose', () => {
    // Otherwise a pull request gutting security-checker.md skips its own
    // security review — the reviewer would be disarmed by the change it was
    // there to catch.
    for (const rubric of ['.claude/agents/security-checker.md', '.claude/agents/code-checker.md']) {
      expect(isProse(rubric)).toBe(false);
      expect(reviewScope([rubric])).toMatchObject({ code: true, security: true });
    }
  });

  it('folds case before testing the directory prefix', () => {
    // The extension test was lowercased and the prefix tests were not, so
    // `.CLAUDE/agents/security-checker.md` skipped both reviews — the exact
    // disarming the test above exists to prevent.
    expect(isProse('.CLAUDE/agents/security-checker.md')).toBe(false);
    expect(reviewScope(['.CLAUDE/agents/security-checker.md'])).toMatchObject({
      code: true,
      security: true,
    });
  });

  it('does not treat Markdown under .github as prose', () => {
    expect(reviewScope(['.github/PULL_REQUEST_TEMPLATE.md'])).toMatchObject({
      code: true,
      security: true,
    });
  });

  it('reviews a workflow change', () => {
    expect(reviewScope(['.github/workflows/verify.yml'])).toMatchObject({
      code: true,
      security: true,
    });
  });

  it('reviews a change to the family tree', () => {
    // data/family.json is invented, and docs/data-governance.md says the
    // trigger that voids that decision is real data arriving. A change to the
    // tree is exactly when someone should look.
    expect(reviewScope(['data/family.json'])).toMatchObject({ code: true, security: true });
  });

  it('runs both reviews when it has no file list', () => {
    // A scope step whose API call failed must not be the reason a change goes
    // unreviewed. The failure this repository keeps paying for is a filter
    // that skipped something and said nothing.
    for (const empty of [[], [''], ['   ', '']]) {
      expect(reviewScope(empty)).toMatchObject({ code: true, security: true });
    }
  });

  it('says what it decided and why, every time', () => {
    for (const files of [['apps/web/src/App.tsx'], ['docs/adoption.md'], [GOVERNANCE], []]) {
      expect(reviewScope(files).why.length).toBeGreaterThan(20);
    }
  });

  it('is not fooled by a leading ./ or a capitalised extension', () => {
    expect(reviewScope(['./docs/adoption.MD'])).toMatchObject({ code: false, security: false });
    expect(reviewScope([`./${GOVERNANCE}`])).toMatchObject({ code: false, security: true });
  });
});

describe('the premise that lets prose be skipped', () => {
  // Skipping Markdown is only safe because scripts/markdown.mjs cannot emit
  // script into the docs site Vercel serves. That is an assumption about
  // another file, so it is checked here rather than asserted in a comment: a
  // renderer that started passing raw HTML through would turn a .md change
  // into a deployment change, and the skip above into a hole.
  it('escapes raw HTML rather than passing it through', () => {
    const html = renderMarkdown('An <script>alert(1)</script> in a paragraph.\n');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('refuses a javascript: link', () => {
    // It renders as the literal text the author typed, so the string survives
    // — what must not survive is the anchor. Asserting on the text would pass
    // for the wrong reason.
    const html = renderMarkdown('[click](javascript:alert(1))\n');
    expect(html).not.toMatch(/<a\s/);
    expect(html).toContain('[click](javascript:alert(1))');
  });
});
