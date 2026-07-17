import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Package 11 planning guard", () => {
  it("requires Package 11B context source hardening before Package 12 model selection", () => {
    const design = source("docs/architecture/PACKAGE_11_PROMPT_POLICY_REPAIR_DESIGN.md");

    expect(design).toContain("Package 11B - Context Source Hardening / Structured Facts");
    expect(design).toMatch(/before Package 12\s+model selection/i);
    expect(design).toContain("app_facts_structured.json");
    expect(design).toContain("Package 04/Ek 6 remains tracked as Package 11B");
  });

  it("keeps Package 11 fallback policy manual-flag-only", () => {
    const design = source("docs/architecture/PACKAGE_11_PROMPT_POLICY_REPAIR_DESIGN.md");

    expect(design).toMatch(/manual-flag-only/i);
    expect(design).toMatch(/runtime-automatic fallback could hide schema\/prompt failures/i);
  });
});
