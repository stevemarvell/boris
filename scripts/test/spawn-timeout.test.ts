// A test that spawns a real process must say how long it may take.
//
// vitest's default is 5 s, and `git`, `node`, `uv`, `bash` and `gh` are fast
// on a quiet machine and slow under load, so a spawning test without its own
// `{ timeout }` passes locally and goes flaky in CI. #247 was that, 56 tests
// across 12 files; #261 fixed them and nothing kept them fixed (#262).
//
// This is textual, not a parser, and a backstop: it blanks comments, strings
// and regex literals, finds each `it(` / `test(` call, and asks whether its
// body names a spawning API or a helper that does, and whether the call carries
// a timeout of its own (an options object, or a trailing number). It will miss
// a spawn hidden behind an imported function it has not been told about
// (SPAWNING_IMPORTS), and it can flag a test that never spawns. Prefer the
// false positive: that costs one `{ timeout }` and a `// Timeout:` reason; the
// false negative costs #247 again.
//
// How it tells a real spawn from an injected fake: by the text of the test.
// A test that hands the code under test a fake runner (`vi.fn()`, a
// `run = async () => ...` it declares itself) names no spawning API and no
// spawning helper, so it is not flagged. A local binding with the same name as
// a spawning helper shadows it, so a test that declares its own `run` is not
// treated as calling the file's real `run`. A fake that is a *file-level*
// helper which spawns is, correctly, a spawn.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { worktreeFiles } from '../git-files.mjs';

/**
 * Imported functions that spawn internally, so the file itself shows no spawn.
 * Only those that always do: a function that spawns through a runner it is
 * handed (labels, triage, stuck, smoke, setup) is a spawn only when the test
 * hands it the real one, and a test that does so says so in its own text.
 */
const SPAWNING_IMPORTS: { name: string; module: string; fakedBy?: RegExp }[] = [
  { name: 'assemble', module: 'assemble.mjs' }, // lists the source's files with `git ls-files`
  { name: 'plan', module: 'assemble.mjs' }, // the same listing; verify-apps.mjs's own `plan` does not spawn
  { name: 'worktreeFiles', module: 'git-files.mjs' }, // `git ls-files`
  { name: 'gh', module: 'labels.mjs' }, // the real `gh` binary
  { name: 'gh', module: 'stuck.mjs' }, // the same
  { name: 'git', module: 'stuck.mjs' }, // the real `git` binary
  // The hook's fix-up runs `uv`/`npx` unless the test hands it an `exec`.
  { name: 'runFixes', module: 'format-edited.mjs', fakedBy: /\bexec\s*[:,}]/ },
];

/** The spawning imports this file actually takes, by the module they come from. */
function importsIn(original: string) {
  return SPAWNING_IMPORTS.filter(({ name, module }) =>
    new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*['"][^'"]*${module.replace('.', '\\.')}['"]`).test(original),
  ).map((i) => ({ ...i, start: 0, end: 0, scope: [0, Infinity] as [number, number] }));
}

/**
 * Spawns outside any test body: they run while the file is collected, where
 * no per-test timeout can apply. Each is named by file and by the text of the
 * call, with the reason. The list is exact: a stale entry fails too.
 */
const COLLECTION_TIME: { file: string; name: string; reason: string }[] = [
  {
    file: 'scripts/test/assemble.test.ts',
    name: 'execFileSync',
    reason: 'module-level `git ls-files`, read once when the file loads; there is no test to hold a timeout',
  },
  {
    file: 'scripts/test/assemble.test.ts',
    name: 'assemble',
    reason: 'a describe.each body assembles each combination once at collection, to share the result between its tests',
  },
  {
    file: 'scripts/test/identity.test.ts',
    name: 'grepHits',
    reason: 'a describe body runs one `git grep` at collection to build the cases; no test owns it',
  },
  {
    file: 'scripts/test/spawn-timeout.test.ts',
    name: 'worktreeFiles',
    reason: 'this check lists the test files once, in its describe body, with a single `git ls-files`',
  },
  {
    file: 'scripts/test/test-census.test.ts',
    name: 'worktreeFiles',
    reason: 'a describe body lists the files once at collection (one `git ls-files`)',
  },
  {
    file: 'scripts/test/vercel-ignore.test.ts',
    name: 'git',
    reason: 'a beforeEach builds the temporary repository; hooks have their own timeout (10 s default) and no test owns it',
  },
  {
    file: 'scripts/test/vercel-ignore.test.ts',
    name: 'commit',
    reason: 'the same beforeEach: its helper wraps `git add` and `git commit`',
  },
];

/** The spawning APIs a piece of code uses, minus any it declares itself. */
function apiUses(text: string, declarations = text): string[] {
  const used: string[] = [];
  for (const m of text.matchAll(SPAWN_API)) if (!shadowed(declarations, m[1]!)) used.push(m[1]!);
  return used;
}

const SPAWN_API =
  /(?<![\w$.])(?:(?:child_process|cp|childProcess)\.)?(execFileSync|execFile|spawnSync|spawn|execSync|exec|fork)\b(?!\s*:)/g;

/**
 * Same length as the input. Comments, string contents and regex literals are
 * replaced by spaces (newlines kept), so nothing inside them can match; code
 * inside a template literal's `${}` is kept.
 */
export function blank(source: string): string {
  const out = source.split('');
  const wipe = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  const templates: number[] = []; // brace depth at which each open `${` began
  let braces = 0;
  let last = ''; // last significant character, to tell a regex from a division
  let i = 0;
  const readTemplate = () => {
    const start = i;
    while (i < source.length) {
      if (source[i] === '\\') i += 2;
      else if (source[i] === '`') {
        wipe(start, i);
        i++;
        return;
      } else if (source[i] === '$' && source[i + 1] === '{') {
        wipe(start, i);
        i += 2;
        templates.push(braces++);
        last = '{';
        return;
      } else i++;
    }
  };
  while (i < source.length) {
    const c = source[i]!;
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      wipe(i, end < 0 ? source.length : end);
      i = end < 0 ? source.length : end;
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const to = end < 0 ? source.length : end + 2;
      wipe(i, to);
      i = to;
    } else if (c === "'" || c === '"') {
      const start = i++;
      while (i < source.length && source[i] !== c && source[i] !== '\n') i += source[i] === '\\' ? 2 : 1;
      wipe(start + 1, i);
      i++;
      last = c;
    } else if (c === '`') {
      i++;
      readTemplate();
      last = '`';
    } else if (c === '/' && (last === '' || '(,=:[!&|?{};>+-*%<~^'.includes(last))) {
      const start = i++;
      let inClass = false;
      while (i < source.length && source[i] !== '\n') {
        if (source[i] === '\\') i++;
        else if (source[i] === '[') inClass = true;
        else if (source[i] === ']') inClass = false;
        else if (source[i] === '/' && !inClass) break;
        i++;
      }
      wipe(start + 1, i);
      i++;
      last = '/';
    } else {
      if (c === '{') braces++;
      if (c === '}') {
        braces--;
        if (templates.length && templates[templates.length - 1] === braces) {
          templates.pop();
          i++;
          readTemplate();
          last = '`';
          continue;
        }
      }
      if (!/\s/.test(c)) last = c;
      i++;
    }
  }
  return out.join('');
}

/** Index of the bracket closing the one at `open`, in blanked text, or -1. */
function closing(clean: string, open: number): number {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const stack: string[] = [];
  for (let i = open; i < clean.length; i++) {
    const c = clean[i]!;
    if (pairs[c]) stack.push(pairs[c]!);
    else if (c === ')' || c === ']' || c === '}') {
      if (stack.pop() !== c) return -1;
      if (!stack.length) return i;
    }
  }
  return -1;
}

const lineOf = (text: string, at: number) => text.slice(0, at).split('\n').length;

interface Span {
  name: string;
  start: number;
  end: number;
  /** Where the name is visible: the block the helper is defined in. */
  scope: [number, number];
  /** An import that spawns unless the test hands it a fake: the text that says so. */
  fakedBy?: RegExp;
}

const esc = (name: string) => name.replace(/\$/g, '\\$');
const mentions = (text: string, name: string) =>
  new RegExp(`(?<![\\w$.])${esc(name)}(?![\\w$])(?!\\s*:)`).test(text);
/**
 * A binding the code declares itself (a `const`, a parameter, a destructured
 * name) shadows the file's helper of that name: that is how a test or a helper
 * injects its own fake runner, and it must not be read as the real one.
 */
const shadowed = (text: string, name: string) =>
  new RegExp(
    `(?:const|let|var|function)\\s+${esc(name)}\\b|[(,]\\s*${esc(name)}\\s*(?::[^,)=]+)?[,)]\\s*(?:=>|:|\\{)|[{,]\\s*${esc(name)}\\s*[,}]\\s*(?:=|\\)\\s*(?:=>|:|\\{))`,
  ).test(text);

/** The innermost `{ … }` around `at`, or the whole file. */
function enclosingBlock(clean: string, at: number): [number, number] {
  const open: number[] = [];
  for (let i = 0; i < at; i++) {
    if (clean[i] === '{') open.push(i);
    else if (clean[i] === '}') open.pop();
  }
  const start = open.pop();
  if (start === undefined) return [0, clean.length];
  const end = closing(clean, start);
  return [start, end < 0 ? clean.length : end];
}

/** Functions defined in the file: `function f(`, `const f = (…) =>`, `const f = function`. */
function helpers(clean: string): Span[] {
  const found: Span[] = [];
  const definition =
    /(?<![\w$.])(?:async\s+)?function\s+([\w$]+)\s*\(|(?<![\w$.])(?:const|let)\s+([\w$]+)\s*(?::[^=;]+)?=\s*(?=(?:async\s*)?(?:function\b|\([^;]*?\)\s*(?::[^=;]+)?=>|[\w$]+\s*=>))/g;
  for (const m of clean.matchAll(definition)) {
    const name = (m[1] ?? m[2])!;
    const from = m.index!;
    let depth = 0;
    let end = clean.length;
    for (let i = from + m[0].length - 1; i < clean.length; i++) {
      const c = clean[i]!;
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) {
        depth--;
        if (depth < 0) {
          end = i;
          break;
        }
        if (depth === 0 && c === '}' && m[1]) {
          end = i + 1;
          break;
        }
      } else if (c === ';' && depth === 0) {
        end = i;
        break;
      }
    }
    found.push({ name, start: from, end, scope: enclosingBlock(clean, from) });
  }
  return found;
}

const visible = (def: Span, at: number) => at >= def.scope[0] && at <= def.scope[1];

/** The file's helpers that spawn, directly or through another helper. */
function spawningHelpers(clean: string, defs: Span[], imported: Span[]): Span[] {
  const spawning = new Set<Span>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const def of defs) {
      if (spawning.has(def)) continue;
      // A helper that merely *defines* a spawning helper does not spawn: take
      // out the bodies of the functions nested inside it.
      const whole = clean.slice(def.start, def.end);
      let body = whole;
      for (const inner of defs) {
        if (inner !== def && inner.start > def.start && inner.end <= def.end) {
          body = body.slice(0, inner.start - def.start) + ' '.repeat(inner.end - inner.start) + body.slice(inner.end - def.start);
        }
      }
      const calls = [...spawning, ...imported].some(
        (other) => other !== def && other.name !== def.name && visible(other, def.start) && mentions(body, other.name) && !shadowed(whole, other.name),
      );
      if (apiUses(body, whole).length || calls) {
        spawning.add(def);
        changed = true;
      }
    }
  }
  return [...spawning];
}

interface Test {
  title: string;
  line: number;
  start: number;
  end: number;
  hasTimeout: boolean;
  unsupported: boolean;
}

/** Every `it(` / `test(` call, with whether it carries a timeout of its own. */
function testsIn(clean: string, original: string): Test[] {
  const tests: Test[] = [];
  for (const m of clean.matchAll(/(?<![\w$.])(?:it|test)((?:\.\w+)*)\s*(?:\(|`)/g)) {
    const chain = m[1]!;
    let open = m.index! + m[0].length - 1;
    // `it.skipIf(cond)('name', fn)`: the first parens are the condition.
    if (/\b(skipIf|runIf)\b/.test(chain) && clean[open] === '(') {
      const cond = closing(clean, open);
      const again = cond < 0 ? -1 : clean.indexOf('(', cond);
      if (again < 0) continue;
      open = again;
    }
    // `it.each(table)('name', fn)` and the tagged-template form: the call that
    // owns the body is the second one, and a table has one timeout for many
    // cases. Not worth supporting; refuse, so a table-driven spawner is seen.
    const unsupported = /\b(each|for)\b/.test(chain) || clean[open] === '`';
    const end = unsupported || clean[open] !== '(' ? open + 1 : closing(clean, open);
    if (end < 0) continue;
    const args = clean.slice(open + 1, end);
    // The test's own options: an object literal that follows a comma at the
    // call's top level (a function body follows `=>`, never a comma), or a
    // trailing number. A `timeout` inside the body belongs to a spawn, not to
    // the test.
    let hasTimeout = /,\s*\d[\d_]*\s*,?\s*$/.test(args);
    for (let i = 0; i < args.length; i++) {
      const c = args[i]!;
      if ('([{'.includes(c)) {
        const close = closing(args, i);
        if (close < 0) break;
        if (c === '{' && /,\s*$/.test(args.slice(0, i))) {
          let inner = '';
          for (let k = i + 1, depth = 0; k < close; k++) {
            if ('([{'.includes(args[k]!)) depth++;
            else if (')]}'.includes(args[k]!)) depth--;
            else if (depth === 0) inner += args[k];
          }
          if (/(^|[,\s])timeout\s*(:|,|$)/.test(inner) || /(^|[,{\s])timeout\s*[:,}]/.test(args.slice(i, close + 1)) && !/=>/.test(args.slice(i, close))) hasTimeout = true;
        }
        i = close;
      }
    }
    const title = /'([^']*)'|"([^"]*)"|`([^`]*)`/.exec(original.slice(open + 1, open + 200))?.[0] ?? '(untitled)';
    tests.push({ title, line: lineOf(clean, m.index!), start: m.index!, end, hasTimeout, unsupported });
  }
  return tests;
}

export interface Finding {
  file: string;
  line: number;
  title: string;
  why: string;
}

/** What is wrong in one file, and every spawn that runs at collection time. */
export function inspect(file: string, original: string) {
  const clean = blank(original);
  const defs = helpers(clean);
  const imports = importsIn(original);
  const spawners = spawningHelpers(clean, defs, imports);
  const known = [...spawners, ...imports];
  const tests = testsIn(clean, original);
  const findings: Finding[] = [];

  for (const t of tests) {
    const body = clean.slice(t.start, t.end + 1);
    const used = apiUses(body);
    for (const h of known) {
      if (h.start >= t.start && h.end <= t.end + 1) continue; // defined inside the test: its spawns are already in the body
      if (visible(h, t.start) && mentions(body, h.name) && !shadowed(body, h.name) && !h.fakedBy?.test(body)) used.push(h.name);
    }
    if (t.unsupported) {
      findings.push({ file, line: t.line, title: t.title, why: 'is table-driven (it.each); this check cannot see its options. Write the cases out, or extend the check.' });
    } else if (used.length && !t.hasTimeout) {
      findings.push({ file, line: t.line, title: t.title, why: `spawns (${[...new Set(used)].join(', ')}) with no { timeout } of its own` });
    }
  }

  // Spawns and spawning-helper calls outside every test body and outside
  // every helper definition: they run when the file is collected, or in a hook.
  const importStatements = [...clean.matchAll(/^import\b[^;]*;/gm)].map((m) => [m.index!, m.index! + m[0].length] as const);
  const inside = [...tests.map((t) => [t.start, t.end] as const), ...defs.map((h) => [h.start, h.end] as const), ...importStatements];
  const names = [...new Set(known.map((h) => h.name))];
  const probe = new RegExp(
    `${SPAWN_API.source}|(?<![\\w$.])(${names.map(esc).join('|') || '(?!)'})\\s*\\(`,
    'g',
  );
  const collection = new Set<string>();
  for (const m of clean.matchAll(probe)) {
    const at = m.index!;
    if (inside.some(([a, b]) => at >= a && at <= b)) continue;
    const name = (m[1] ?? m[2])!;
    const def = known.find((h) => h.name === name);
    if (def && !visible(def, at)) continue;
    collection.add(name);
  }
  return { findings, collection: [...collection] };
}

describe('every test that spawns a process carries its own timeout', () => {
  const root = resolve(__dirname, '../..');
  const files = worktreeFiles(root).filter((p) => /^scripts\/test\/[^/]+\.test\.ts$/.test(p));
  const results = files.map((file) => ({ file, ...inspect(file, readFileSync(resolve(root, file), 'utf8')) }));

  it('looks at the whole suite, and at spawning tests in it', () => {
    // A check that quietly matched nothing would pass forever.
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain('scripts/test/assemble.test.ts');
    const spawningFiles = files.filter((file) => {
      const clean = blank(readFileSync(resolve(root, file), 'utf8'));
      return testsIn(clean, clean).some((t) => {
        SPAWN_API.lastIndex = 0;
        return SPAWN_API.test(clean.slice(t.start, t.end + 1));
      });
    });
    expect(spawningFiles.length).toBeGreaterThanOrEqual(8);
  });

  it('finds no spawning test without a timeout', () => {
    const all = results.flatMap((r) => r.findings);
    expect(all.map((f) => `${f.file}:${f.line} "${f.title}" ${f.why}`)).toEqual([]);
  });

  it('knows exactly which spawns run at collection time, and why', () => {
    const seen = new Set(results.flatMap((r) => r.collection.map((name) => `${r.file} ${name}`)));
    const declared = new Set(COLLECTION_TIME.map((e) => `${e.file} ${e.name}`));
    for (const e of COLLECTION_TIME) expect(e.reason.length, e.file).toBeGreaterThan(20);
    expect([...seen].filter((s) => !declared.has(s))).toEqual([]);
    expect([...declared].filter((d) => !seen.has(d))).toEqual([]);
  });
});

describe('the check itself, on fixtures', () => {
  // `${'it'}` keeps these fixtures from being read as tests by anything
  // textual, this file included.
  const fixture = (head: string, body: string) =>
    `import { execFileSync, spawnSync } from 'node:child_process';\n${head}\n${'it'}('does a thing', ${head ? '' : ''}${body}\n`;

  const verdict = (source: string) => inspect('fixture.test.ts', source).findings;

  it('fails a test that spawns with no timeout', () => {
    const found = verdict(fixture('', `() => {\n  execFileSync('git', ['status']);\n});`));
    expect(found).toHaveLength(1);
    expect(found[0]!.why).toMatch(/execFileSync.*no \{ timeout \}/);
  });

  it('passes the same test once it has an options-object timeout', () => {
    expect(verdict(fixture('', `{ timeout: 15_000 }, () => {\n  execFileSync('git', ['status']);\n});`))).toEqual([]);
  });

  it('passes a numeric trailing timeout', () => {
    expect(verdict(fixture('', `() => {\n  spawnSync('git');\n}, 15000);`))).toEqual([]);
  });

  it('does not take the spawn option\'s own timeout for the test\'s', () => {
    const found = verdict(fixture('', `() => {\n  execFileSync('git', [], { timeout: 1000 });\n});`));
    expect(found).toHaveLength(1);
  });

  it('flags a test that spawns through a helper the file defines', () => {
    const head = `const git = (...a: string[]) => execFileSync('git', a, { encoding: 'utf8' });`;
    expect(verdict(fixture(head, `() => {\n  git('init');\n});`))).toHaveLength(1);
    expect(verdict(fixture(head, `{ timeout: 9000 }, () => {\n  git('init');\n});`))).toEqual([]);
  });

  it('follows a helper that spawns through another helper', () => {
    const head = `function inner() { return spawnSync('git'); }\nfunction outer() { return inner(); }`;
    expect(verdict(fixture(head, `() => {\n  outer();\n});`))).toHaveLength(1);
  });

  it('flags a table-driven test, which it cannot read', () => {
    const source = `it${'.each'}([1, 2])('case %i', () => { execFileSync('git'); });\n`;
    expect(verdict(source)).toHaveLength(1);
  });

  it('does not flag a test that injects a fake runner', () => {
    const head = `const run = (cmd: string) => execFileSync(cmd);\nfunction subject(deps: { run: (c: string) => string }) { return deps.run('x'); }`;
    // Declares its own `run`: the file's spawning `run` is shadowed.
    expect(verdict(fixture(head, `() => {\n  const run = () => 'fake';\n  expect(subject({ run })).toBe('fake');\n});`))).toEqual([]);
    // Names no spawning API or helper at all.
    expect(verdict(fixture('', `() => {\n  const fake = vi.fn(() => 'ok');\n  expect(fake()).toBe('ok');\n});`))).toEqual([]);
    // The same test without the local `run` is a real spawn.
    expect(verdict(fixture(head, `() => {\n  expect(subject({ run })).toBe('x');\n});`))).toHaveLength(1);
  });

  it('is not fooled by a spawn named only in a string, comment or regex', () => {
    const body = `() => {\n  // execFileSync('git') would be slow\n  expect('spawnSync(x)').toMatch(/execFile\\(/);\n  expect(\`\${'a'} execSync(b)\`).toBeTruthy();\n});`;
    expect(verdict(fixture('', body))).toEqual([]);
  });

  it('reports a spawn at collection time instead of flagging it', () => {
    const source = `import { execFileSync } from 'node:child_process';\nconst list = execFileSync('git', ['ls-files']);\n${'it'}('reads', () => { expect(list).toBeTruthy(); });\n`;
    const result = inspect('fixture.test.ts', source);
    expect(result.findings).toEqual([]);
    expect(result.collection).toHaveLength(1);
  });
});
