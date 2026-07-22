import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RESPONSES_EXPANDED_SCENARIOS,
  RESPONSES_GOLDEN_SCENARIOS,
  type ResponsesGoldenRepeatedReport,
} from "../../modelAdapter/responsesGoldenReplay.js";
import { configuredModelIsEligible } from "../../modelAdapter/responsesModelQualification.js";

function repeated(overrides: Partial<ResponsesGoldenRepeatedReport> = {}): ResponsesGoldenRepeatedReport {
  return {
    runs_total: 3,
    target_pass_threshold: 13,
    target_pass_rate: 1,
    all_runs_meet_target: true,
    unsafe_claim_count_total: 0,
    real_outbound_count: 0,
    raw_output_logged: false,
    validator_authoritative: true,
    reports: Array.from({ length: 3 }, () => ({
      scenarios_total: 13,
      scenarios_passed: 13,
      scenarios_failed: 0,
      valid_schema_rate: 1,
      validator_reject_rate: 0,
      safe_fallback_rate: 0,
      unsafe_claim_count: 0,
      role_boundary_pass_rate: 1,
      average_latency_ms: 1,
      input_tokens_total: 1,
      output_tokens_total: 1,
      real_outbound_count: 0,
      raw_output_logged: false,
      validator_authoritative: true,
      self_report_mismatch_total: 0,
      provider_failure_count: 0,
      parse_failure_count: 0,
      model_schema_rejection_count: 0,
      model_semantic_rejection_count: 0,
      model_quality_rejection_count: 0,
      transient_failures_recovered: 0,
      transient_failure_attempt_count: 0,
      transient_failure_classification_counts: {},
      results: [],
    })),
    ...overrides,
  };
}

describe("Package 12 configured model qualification", () => {
  it("defines the original 13-scenario baseline and an expanded set", () => {
    expect(RESPONSES_GOLDEN_SCENARIOS).toHaveLength(13);
    expect(RESPONSES_EXPANDED_SCENARIOS.length).toBeGreaterThanOrEqual(10);
    expect(RESPONSES_EXPANDED_SCENARIOS.some((scenario) => scenario.id === "p12_layla_ios_structured_fact")).toBe(true);
    expect(RESPONSES_EXPANDED_SCENARIOS.some((scenario) => scenario.id === "p12_unknown_app_missing_info")).toBe(true);
  });

  it("marks only fully configured, schema-valid, safe runs eligible", () => {
    expect(configuredModelIsEligible({ configuredModelPresent: true, baseline: repeated(), expanded: repeated() })).toBe(true);
    expect(configuredModelIsEligible({ configuredModelPresent: false, baseline: repeated(), expanded: repeated() })).toBe(false);
    expect(configuredModelIsEligible({
      configuredModelPresent: true,
      baseline: repeated({ unsafe_claim_count_total: 1 }),
      expanded: repeated(),
    })).toBe(false);
    const invalidSchema = repeated();
    invalidSchema.reports[1].valid_schema_rate = 0.9;
    expect(configuredModelIsEligible({ configuredModelPresent: true, baseline: invalidSchema, expanded: repeated() })).toBe(false);
  });

  it("keeps model selection config-driven and owner-approved", () => {
    const script = readFileSync(resolve(process.cwd(), "scripts/responsesModelQualification.ts"), "utf8");
    const design = readFileSync(resolve(process.cwd(), "docs/architecture/PACKAGE_12_REAL_MODEL_QUALIFICATION_DESIGN.md"), "utf8");

    expect(script).toContain("process.env.OPENAI_RESPONSES_MODEL");
    expect(script).toContain("process.env.RESPONSES_QUALIFICATION_REAL");
    expect(script).not.toMatch(/gpt-4\.1|gpt-4o|gpt-5/i);
    expect(design).toMatch(/Any model change requires owner\s+approval/i);
    expect(design).toContain("Package 12B");
  });
});
