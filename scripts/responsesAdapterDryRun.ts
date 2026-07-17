import { createOpenAIResponsesAdapter } from "../src/modelAdapter/ResponsesAdapter.js";
import {
  RESPONSES_GOLDEN_SCENARIOS,
  runResponsesGoldenReplay,
} from "../src/modelAdapter/responsesGoldenReplay.js";

async function main(): Promise<void> {
  const apiKeyPresent = Boolean(process.env.OPENAI_API_KEY);
  const model = process.env.RESPONSES_DRY_RUN_MODEL ?? process.env.OPENAI_RESPONSES_MODEL;
  const realDryRunEnabled = process.env.RESPONSES_DRY_RUN_REAL === "true";
  const summary: Record<string, unknown> = {
    script: "responsesAdapterDryRun",
    api_key_present: apiKeyPresent,
    model_configured: Boolean(model),
    real_dry_run_enabled: realDryRunEnabled,
    secrets_printed: "NO",
    raw_output_printed: "NO",
    real_outbound_count: 0,
  };

  if (!realDryRunEnabled) {
    console.log(JSON.stringify({ ...summary, status: "SKIPPED_REAL_CALL", reason: "explicit_flag_required" }));
    return;
  }
  if (!apiKeyPresent || !model) {
    console.log(JSON.stringify({ ...summary, status: "SKIPPED_MISSING_CONFIG" }));
    return;
  }

  const adapter = await createOpenAIResponsesAdapter({ apiKey: process.env.OPENAI_API_KEY!, model });
  const report = await runResponsesGoldenReplay(adapter, RESPONSES_GOLDEN_SCENARIOS.slice(0, 1));
  console.log(JSON.stringify({
    ...summary,
    status: report.scenarios_passed === 1 ? "PASS" : "FAIL",
    schema_valid: report.valid_schema_rate === 1,
    role_boundary_valid: report.role_boundary_pass_rate === 1,
    usage_metadata_present: report.input_tokens_total + report.output_tokens_total > 0,
    latency_ms: report.average_latency_ms,
  }));
  if (report.scenarios_passed !== 1) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({
    script: "responsesAdapterDryRun",
    status: "FAILED",
    error_name: error instanceof Error ? error.name : "UnknownError",
    secrets_printed: "NO",
    raw_output_printed: "NO",
    real_outbound_count: 0,
  }));
  process.exitCode = 1;
});
