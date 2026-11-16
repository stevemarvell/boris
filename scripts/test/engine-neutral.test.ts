import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The engine files reach every product unchanged, so none may claim what a
// particular repository serves (#334): a product with sign-in and stored data
// was told nothing was at stake. What is exposed comes from
// docs/data-governance.md, read by the reviewer.
// This file reads catalogue.json, which is base-only, so it is base-only too
// (catalogue.json `base`): the engine files it scans are byte-identical in a
// product, so one scan in the base covers them all.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const SKIP = new Set(["node_modules", ".git"]);

// Every regular file under a path, recursively; a path that is itself a file
// is returned as is.
function walk(rel: string): string[] {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [rel];
  return readdirSync(abs, { withFileTypes: true })
    .filter((e) => !SKIP.has(e.name))
    .flatMap((e) => walk(join(rel, e.name)));
}

// The engine paths come from catalogue.json, not a list here, so a path
// added to the engine is scanned without touching this test.
const CATALOGUE = JSON.parse(
  readFileSync(join(ROOT, "catalogue.json"), "utf8"),
) as { engine: { paths: string[] } };
const ENGINE = CATALOGUE.engine.paths.flatMap(walk).map((p) => p.replace(/\\/g, "/"));
const CLAIM = /serves? no (real )?data/i;

const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const flat = (p: string) => read(p).replace(/\s+/g, " ");

describe("engine files make no claim about what is served", () => {
  it("finds the engine files it scans", () => {
    expect(ENGINE).toContain(".claude/agents/security-checker.md");
    expect(ENGINE).toContain(".github/workflows/claude-code-review.yml");
  });

  it("scans recursively, including docs/sops.md and the skills", () => {
    expect(ENGINE).toContain("docs/sops.md");
    expect(ENGINE).toContain(".claude/skills/sync-ai-layer/SKILL.md");
    expect(ENGINE).toContain("scripts/test/engine-neutral.test.ts");
    expect(ENGINE.some((p) => p.includes("node_modules"))).toBe(false);
  });

  it("no engine file claims what is served", () => {
    const offenders = ENGINE.filter((p) => CLAIM.test(flat(p)));
    expect(offenders).toEqual([]);
  });

  it("the pattern catches the wordings the SOPs used", () => {
    // Built from parts so this file does not contain the phrases it scans for.
    const no = "no";
    expect(CLAIM.test(`the deployed apps serve ${no} data at all`)).toBe(true);
    expect(CLAIM.test(`because the apps serve ${no} real data.`)).toBe(true);
    expect(CLAIM.test("a site that serves data")).toBe(false);
  });

  it("the sops point at data-governance for what is served", () => {
    expect(flat("docs/sops.md")).toContain(
      "what the deployed apps serve is in `docs/data-governance.md`",
    );
  });

  it("the security rubric holds neither stale phrase", () => {
    const rubric = flat(".claude/agents/security-checker.md");
    expect(rubric).not.toMatch(CLAIM);
    expect(rubric).not.toMatch(/placeholder shell/i);
  });

  it("the rubric reads the load-bearing controls from data-governance and ranks a missing list high", () => {
    const rubric = flat(".claude/agents/security-checker.md");
    expect(rubric).toContain("the controls everything else leans on");
    expect(rubric).toContain("names no controls");
    expect(rubric).toMatch(/finding, ranked high/);
    expect(rubric).toContain(
      "A document that states nothing is served or stored satisfies this rule.",
    );
  });

  it("the sync checklist confirms the product names its controls under a heading", () => {
    expect(flat(".claude/skills/sync-ai-layer/SKILL.md")).toContain(
      "`docs/data-governance.md` still names its load-bearing controls under a heading",
    );
  });

  it("the CI security prompt takes what is exposed from data-governance", () => {
    const wf = flat(".github/workflows/claude-code-review.yml");
    expect(wf).toContain(
      "that document says what is exposed and which controls are load-bearing",
    );
    expect(wf).not.toMatch(/deployed apps serve/i);
  });
});
