import { createOpenAIResponsesAdapter } from "../src/modelAdapter/ResponsesAdapter.js";
import {
  RESPONSES_EXPANDED_SCENARIOS,
  RESPONSES_GOLDEN_SCENARIOS,
  runRepeatedResponsesGoldenReplay,
  type ResponsesGoldenScenario,
} from "../src/modelAdapter/responsesGoldenReplay.js";

const TARGETED_IDS = new Set([
  "p12_unknown_app_missing_info",
  "p12_known_state_direct_question",
  "p12_text_only_state_update",
]);

type SuiteName = "targeted" | "expanded" | "baseline";

function suiteConfig(name: SuiteName): { scenarios: ResponsesGoldenScenario[]; threshold: number } {
  if (name === "targeted") {
    return {
      scenarios: RESPONSES_EXPANDED_SCENARIOS.filter((scenario) => TARGETED_IDS.has(scenario.id)),
      threshold: 3,
    };
  }
  if (name === "expanded") return { scenarios: RESPONSES_EXPANDED_SCENARIOS, threshold: 9 };
  return { scenarios: RESPONSES_GOLDEN_SCENARIOS, threshold: 12 };
}

async function main(): Promise<void> {
  const suite = (process.env.RESPONSES_QUALIFICATION_SUITE ?? "targeted") as SuiteName;
  if (!(["targeted", "expanded", "baseline"] as string[]).includes(suite)) {
    throw new Error("INVALID_QUALIFICATION_SUITE");
  }
  if (process.env.RESPONSES_QUALIFICATION_REAL !== "true") {
    throw new Error("REAL_QUALIFICATION_FLAG_REQUIRED");
  }
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_RESPONSES_MODEL?.trim();
  if (!apiKey || !model) throw new Error("QUALIFICATION_CONFIG_MISSING");

  const config = suiteConfig(suite);
  const adapter = await createOpenAIResponsesAdapter({ apiKey, model });
  const report = await runRepeatedResponsesGoldenReplay(() => adapter, {
    runs: 3,
    scenarios: config.scenarios,
    targetPassThreshold: config.threshold,
    maxTransientRetries: 1,
    retryDelayMs: 2_000,
  });

  console.log(JSON.stringify({
    suite,
    model_configured: true,
    runs: report.reports.map((run, index) => ({
      run: index + 1,
      passed: run.scenarios_passed,
      total: run.scenarios_total,
      unsafe: run.unsafe_claim_count,
      provider_failures: run.provider_failure_count,
      parse_failures: run.parse_failure_count,
      schema_rejects: run.model_schema_rejection_count,
      semantic_rejects: run.model_semantic_rejection_count,
      quality_rejects: run.model_quality_rejection_count,
      recovered_transient_failures: run.transient_failures_recovered,
      failures: run.results
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
        })),
    })),
    all_runs_meet_target: report.all_runs_meet_target,
    unsafe_total: report.unsafe_claim_count_total,
    real_outbound_count: report.real_outbound_count,
    raw_output_logged: report.raw_output_logged,
    secrets_printed: false,
  }));

  if (!report.all_runs_meet_target) process.exitCode = 1;
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
