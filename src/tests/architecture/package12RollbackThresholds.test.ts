import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const designPath = resolve("docs/architecture/PACKAGE_12_NUMERIC_AUTO_ROLLBACK_THRESHOLDS_DESIGN.md");
const design = readFileSync(designPath, "utf8");

describe("Package 12 numeric automatic rollback thresholds", () => {
  it("keeps shadow and canary disabled while defining flag-off rollback", () => {
    expect(design).toContain("MODEL_ADAPTER_LAYER_ENABLED=false");
    expect(design).toContain("MODEL_ADAPTER_CANARY_MODE=off");
    expect(design).toContain("manual-flag-only");
    expect(design).toContain("SHADOW_OR_CANARY_OPENED=false");
  });

  it("defines immediate numeric safety and egress stops", () => {
    expect(design).toMatch(/`unsafe_claim_count` \| `>= 1`/);
    expect(design).toMatch(/`outbound_count != 1`[^\n]*\| `>= 1`/);
    expect(design).toMatch(/hash mismatch \| `>= 1`/);
    expect(design).toMatch(/unauthorized role, tenant, group, spoof, or expired approval[^\n]*\| `>= 1`/);
  });

  it("defines minimum-sample quality and provider thresholds", () => {
    expect(design).toMatch(/minimum 20 terminal events/i);
    expect(design).toMatch(/`safe_fallback_rate` \| `> 5%`/);
    expect(design).toMatch(/`validator_reject_rate` \| `> 10%`/);
    expect(design).toMatch(/schema\/parse rejection rate \| `> 2%`/);
    expect(design).toMatch(/final provider failure rate after allowed retry \| `> 5%`/);
  });

  it("requires both baseline and expanded qualification before canary", () => {
    expect(design).toContain("`12/13`");
    expect(design).toContain("`9/10`");
    expect(design).toContain("Layla structured-fact scenario must pass `3/3`");
    expect(design).toContain("Linky-code structured-fact scenario must pass `3/3`");
    expect(design).toContain("PACKAGE_12_EXPANDED_STATUS=NOT_ELIGIBLE_FOR_CANARY");
  });
});
