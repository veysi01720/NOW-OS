import { createOpenAIResponsesAdapter } from "../src/modelAdapter/ResponsesAdapter.js";
import {
  RESPONSES_COMBINED_SCENARIOS,
  RESPONSES_EXPANDED_SCENARIOS,
  RESPONSES_GOLDEN_SCENARIOS,
  RESPONSES_TARGETED_SCENARIO_IDS,
  runResponsesGoldenReplay,
  type ResponsesGoldenReport,
  type ResponsesGoldenScenarioResult,
} from "../src/modelAdapter/responsesGoldenReplay.js";

const BASELINE_IDS = new Set(RESPONSES_GOLDEN_SCENARIOS.map((scenario) => scenario.id));
const TARGETED_IDS = new Set<string>(RESPONSES_TARGETED_SCENARIO_IDS);
const EXPANDED_IDS = new Set(RESPONSES_EXPANDED_SCENARIOS.map((scenario) => scenario.id));

interface SuiteScore {
  passed: number;
  total: number;
  target: number;
  target_met: boolean;
  failures: string[];
}

function scoreSuite(results: ResponsesGoldenScenarioResult[], ids: Set<string>, target: number): SuiteScore {
  const selected = results.filter((result) => ids.has(result.id));
  const passed = selected.filter((result) => result.passed).length;
  return {
    passed,
    total: selected.length,
    target,
    target_met: passed >= target,
    failures: selected.filter((result) => !result.passed).map((result) => result.id),
  };
}

function sanitizedFailures(report: ResponsesGoldenReport): Array<Record<string, unknown>> {
  return report.results
    .filter((result) => !result.passed)
    .map((result) => ({
      id: result.id,
      classification: result.execution_classification,
      reasons: result.reason_codes,
      actual_next_action: result.actual_next_action,
      actual_chosen_actions: result.actual_chosen_actions,
      missing_required_group_indexes: result.missing_required_group_indexes,
      attempts: result.attempt_count,
      retry_recovered: result.retry_recovered,
    }));
}

async function main(): Promise<void> {
  if (process.env.RESPONSES_QUALIFICATION_REAL !== "true") {
    throw new Error("REAL_QUALIFICATION_FLAG_REQUIRED");
  }
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_RESPONSES_MODEL?.trim();
  if (!apiKey || !model) throw new Error("QUALIFICATION_CONFIG_MISSING");

  const adapter = await createOpenAIResponsesAdapter({ apiKey, model });
  const runs = [];
  for (let index = 0; index < 3; index += 1) {
    const report = await runResponsesGoldenReplay(adapter, RESPONSES_COMBINED_SCENARIOS, {
      maxTransientRetries: 1,
      retryDelayMs: 2_000,
    });
    const baseline = scoreSuite(report.results, BASELINE_IDS, 12);
    const targeted = scoreSuite(report.results, TARGETED_IDS, 3);
    const expanded = scoreSuite(report.results, EXPANDED_IDS, 9);
    runs.push({
      run: index + 1,
      unique_scenarios_executed: report.scenarios_total,
      baseline,
      targeted,
      expanded,
      unsafe: report.unsafe_claim_count,
      provider_failures: report.provider_failure_count,
      parse_failures: report.parse_failure_count,
      schema_rejects: report.model_schema_rejection_count,
      semantic_rejects: report.model_semantic_rejection_count,
      quality_rejects: report.model_quality_rejection_count,
      recovered_transient_failures: report.transient_failures_recovered,
      failures: sanitizedFailures(report),
      all_suite_targets_met: baseline.target_met
        && targeted.target_met
        && expanded.target_met
        && report.unsafe_claim_count === 0,
    });
  }

  const allRunsMeetTarget = runs.every((run) => run.all_suite_targets_met);
  console.log(JSON.stringify({
    procedure: "combined_regression",
    model_configured: true,
    unique_catalog_size: RESPONSES_COMBINED_SCENARIOS.length,
    catalog_membership: {
      baseline: BASELINE_IDS.size,
      targeted: TARGETED_IDS.size,
      expanded: EXPANDED_IDS.size,
      targeted_is_expanded_subset: [...TARGETED_IDS].every((id) => EXPANDED_IDS.has(id)),
    },
    runs,
    all_runs_meet_all_suite_targets: allRunsMeetTarget,
    unsafe_total: runs.reduce((sum, run) => sum + run.unsafe, 0),
    real_outbound_count: 0,
    raw_output_logged: false,
    secrets_printed: false,
  }));

  if (!allRunsMeetTarget) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({
    status: "FAILED",
    error_name: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    real_outbound_count: 0,
    raw_output_logged: false,
    secrets_printed: false,
  }));
  process.exitCode = 1;
});
