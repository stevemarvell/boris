import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// An unpinned claude-code-action step runs on whatever the default model is,
// which drifts (the @claude workflow was observed running Opus). Every step
// must pass --model in its claude_args.
const DIR = join(
  resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
  ".github/workflows",
);

describe("every claude-code-action step pins its model", () => {
  for (const file of readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f))) {
    const text = readFileSync(join(DIR, file), "utf8");
    // Steps start at "- " lines; split on them and keep those using the action.
    const steps = text
      .split(/\n\s+- (?=\w+:)/)
      .filter((s) => /uses:\s*anthropics\/claude-code-action@/.test(s));
    for (const [i, step] of steps.entries()) {
      it(`${file} step ${i + 1} passes --model in claude_args`, () => {
        const args = step.match(/claude_args:\s*\|\n((?:[ \t]+.*\n?)+)/);
        expect(args, "claude_args block").not.toBeNull();
        const lines = (args?.[1] ?? "")
          .split("\n")
          .filter((l) => !l.trim().startsWith("#"));
        expect(lines.some((l) => /^\s*--model\s+\S+/.test(l))).toBe(true);
      });
    }
  }

  it("finds the steps it is meant to check", () => {
    const text = readFileSync(join(DIR, "claude.yml"), "utf8");
    expect(text).toMatch(/uses:\s*anthropics\/claude-code-action@/);
  });
});
