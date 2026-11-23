import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// docs/sops-rules.md is the short page implementers load; docs/sops.md holds
// the reasoning (#331). Nothing else ties the two together, so a SOP added to
// one and not the other would go unnoticed.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const sopHeadings = (text: string) => text.split("\n").filter((l) => /^## SOP \d+:/.test(l));
// GitHub's anchor for a heading: lowercased, punctuation dropped, spaces to hyphens.
const slug = (heading: string) =>
  heading.replace(/^#+\s*/, "").toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s/g, "-");

describe("docs/sops-rules.md", () => {
  const sops = read("docs/sops.md");
  const rules = read("docs/sops-rules.md");

  it("is at most 1,200 words", () => {
    expect(rules.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(1200);
  });

  it("has the same SOP headings, in the same order, as docs/sops.md", () => {
    const full = sopHeadings(sops);
    expect(full.length).toBeGreaterThanOrEqual(10);
    expect(sopHeadings(rules)).toEqual(full);
  });

  it("links each section to the matching heading in docs/sops.md", () => {
    const anchors = sopHeadings(sops).map(slug);
    for (const anchor of anchors) {
      expect(rules, anchor).toContain(`(sops.md#${anchor})`);
    }
  });

  it("carries every row of the declared-ceilings table", () => {
    const rows = (text: string) => text.split("\n").filter((l) => /^\| /.test(l) && l.includes("|"));
    const ceilings = rows(sops.slice(sops.indexOf("### The declared ceilings"), sops.indexOf("### What enforces this")));
    expect(ceilings.length).toBeGreaterThan(5);
    for (const row of ceilings) expect(rules, row).toContain(row);
  });

  it("is pointed at by docs/sops.md", () => {
    expect(sops).toContain("docs/sops-rules.md");
  });
});
