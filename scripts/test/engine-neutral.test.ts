import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The engine files reach every product unchanged, so none may claim what a
// particular repository serves (#334): a product with sign-in and stored data
// was told nothing was at stake. What is exposed comes from
// docs/data-governance.md, read by the reviewer.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(dir, e.name));
}

const ENGINE = [...files(".claude/agents"), ...files(".github/workflows")];
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const flat = (p: string) => read(p).replace(/\s+/g, " ");

describe("engine files make no claim about what is served", () => {
  it("finds the engine files it scans", () => {
    expect(ENGINE).toContain(".claude/agents/security-checker.md");
    expect(ENGINE).toContain(".github/workflows/claude-code-review.yml");
  });

  it("no file under .claude/agents or .github/workflows says 'serve no data'", () => {
    const offenders = ENGINE.filter((p) => /serve no data/i.test(flat(p)));
    expect(offenders).toEqual([]);
  });

  it("the security rubric holds neither stale phrase", () => {
    const rubric = flat(".claude/agents/security-checker.md");
    expect(rubric).not.toMatch(/serve no data/i);
    expect(rubric).not.toMatch(/placeholder shell/i);
  });

  it("the rubric reads the load-bearing controls from data-governance and ranks a missing list high", () => {
    const rubric = flat(".claude/agents/security-checker.md");
    expect(rubric).toContain("the controls everything else leans on");
    expect(rubric).toContain("names no controls");
    expect(rubric).toMatch(/finding, ranked high/);
  });

  it("the CI security prompt takes what is exposed from data-governance", () => {
    const wf = flat(".github/workflows/claude-code-review.yml");
    expect(wf).toContain(
      "that document says what is exposed and which controls are load-bearing",
    );
    expect(wf).not.toMatch(/deployed apps serve/i);
  });
});
