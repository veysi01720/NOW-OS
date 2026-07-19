import { createOpenAIResponsesAdapter } from "../src/modelAdapter/ResponsesAdapter.js";
import {
  RESPONSES_COMBINED_SCENARIOS,
  RESPONSES_CANARY_EXCLUDED_SCENARIO_IDS,
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
const CANARY_EXCLUDED_IDS = new Set<string>(RESPONSES_CANARY_EXCLUDED_SCENARIO_IDS);
const CANARY_TARGETED_IDS = new Set([...TARGETED_IDS].filter((id) => !CANARY_EXCLUDED_IDS.has(id)));
const CANARY_EXPANDED_IDS = new Set([...EXPANDED_IDS].filter((id) => !CANARY_EXCLUDED_IDS.has(id)));

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
      provider_http_status: result.provider_http_status,
      provider_error_type: result.provider_error_type,
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

  const requestedScenarioId = process.env.RESPONSES_QUALIFICATION_SCENARIO?.trim();
  const scenarios = requestedScenarioId
    ? RESPONSES_COMBINED_SCENARIOS.filter((scenario) => scenario.id === requestedScenarioId)
    : RESPONSES_COMBINED_SCENARIOS;
  if (scenarios.length === 0) throw new Error("QUALIFICATION_SCENARIO_NOT_FOUND");
  const runsTotal = Number.parseInt(process.env.RESPONSES_QUALIFICATION_RUNS ?? "3", 10);
  const runsCount = Number.isInteger(runsTotal) && runsTotal > 0 ? runsTotal : 3;
  const adapter = await createOpenAIResponsesAdapter({ apiKey, model });
  const runs = [];
  const totalCalls = scenarios.length * runsCount;
  const suiteStartedAt = Date.now();
  for (let index = 0; index < runsCount; index += 1) {
    const report = await runResponsesGoldenReplay(adapter, scenarios, {
      maxTransientRetries: 2,
      retryDelayMs: 3_000,
      interCallDelayMs: 2_500,
      heartbeatMs: 10_000,
      onProgress: (event) => {
        const ordinal = index * scenarios.length + event.scenarioIndex + 1;
        const elapsedSeconds = Math.round((Date.now() - suiteStartedAt) / 1000);
        const suffix = event.classification ? ` classification=${event.classification}` : "";
        console.log(`[${ordinal}/${totalCalls}] ${event.scenarioId} - ${elapsedSeconds}s elapsed (${event.phase}, attempt=${event.attempt})${suffix}`);
      },
    });
    const baseline = scoreSuite(report.results, BASELINE_IDS, 12);
    const targeted = scoreSuite(report.results, CANARY_TARGETED_IDS, CANARY_TARGETED_IDS.size);
    const expanded = scoreSuite(report.results, CANARY_EXPANDED_IDS, CANARY_EXPANDED_IDS.size);
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
      missing_policy_normalization_applied_count: report.missing_policy_normalization_applied_count ?? 0,
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
    unique_catalog_size: scenarios.length,
    requested_scenario: requestedScenarioId ?? null,
    runs_requested: runsCount,
    catalog_membership: {
      baseline: BASELINE_IDS.size,
      targeted: CANARY_TARGETED_IDS.size,
      expanded: CANARY_EXPANDED_IDS.size,
      catalog_targeted: TARGETED_IDS.size,
      catalog_expanded: EXPANDED_IDS.size,
      targeted_is_expanded_subset: [...CANARY_TARGETED_IDS].every((id) => CANARY_EXPANDED_IDS.has(id)),
      canary_excluded_scenarios: [...CANARY_EXCLUDED_IDS],
      canary_intent_scope: ["greeting_or_first_contact", "candidate_first_contact"],
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
