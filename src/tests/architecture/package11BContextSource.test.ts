import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Package 11B context-source hardening guard", () => {
  it("keeps markdown authoritative while requiring matching structured facts", () => {
    const design = source("docs/architecture/PACKAGE_11B_CONTEXT_SOURCE_HARDENING_DESIGN.md");
    const integrity = source("src/bridge/sourceIntegrity.ts");

    expect(design).toContain("`app_facts.md` remains the official human-readable narrative source");
    expect(design).toContain("`app_facts_structured.json` is the machine-readable representation");
    expect(integrity).toContain("app_facts_structured_matches_markdown");
    expect(integrity).toContain("structured_app_facts_official_values_present");
  });

  it("requires Package 11B acceptance before Package 12 real-model testing", () => {
    const design = source("docs/architecture/PACKAGE_11B_CONTEXT_SOURCE_HARDENING_DESIGN.md");

    expect(design).toMatch(/Package 12 must not start until Package 11B/i);
    expect(design).toContain("configured `OPENAI_RESPONSES_MODEL`");
    expect(design).toContain("13-scenario baseline");
    expect(design).toContain("Package 12B");
  });

  it("keeps test fixtures off the production knowledge path", () => {
    const design = source("docs/architecture/PACKAGE_11B_CONTEXT_SOURCE_HARDENING_DESIGN.md");
    const fixture = source("src/tests/fixtures/knowledgeBankFixture.ts");

    expect(design).toContain("temporary directory");
    expect(design).toContain("must not read, write, copy, or delete the production `data/knowledge_bank`");
    expect(fixture).toContain("app_facts_structured.json");
  });
});
