import { createOpenAIResponsesAdapter } from "../src/modelAdapter/ResponsesAdapter.js";
import { runResponsesGoldenReplay } from "../src/modelAdapter/responsesGoldenReplay.js";

async function main(): Promise<void> {
  const model = process.env.OPENAI_RESPONSES_MODEL ?? process.env.RESPONSES_DRY_RUN_MODEL;
  if (!process.env.OPENAI_API_KEY || !model) {
    console.log(JSON.stringify({
      status: "SKIPPED_MISSING_CONFIG",
      api_key_present: Boolean(process.env.OPENAI_API_KEY),
      model_configured: Boolean(model),
      secrets_printed: false,
      raw_output_logged: false,
      real_outbound_count: 0,
    }));
    return;
  }

  const adapter = await createOpenAIResponsesAdapter({ apiKey: process.env.OPENAI_API_KEY, model });
  const report = await runResponsesGoldenReplay(adapter);
  const qualityPass = report.valid_schema_rate === 1
    && report.role_boundary_pass_rate === 1
    && report.unsafe_claim_count === 0
    && report.scenarios_passed / report.scenarios_total >= 0.85;
  console.log(JSON.stringify({
    status: qualityPass ? "PASS" : "FAIL",
    model,
    ...report,
    secrets_printed: false,
  }));
  if (!qualityPass) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({
    status: "FAILED",
    error_name: error instanceof Error ? error.name : "UnknownError",
    secrets_printed: false,
    raw_output_logged: false,
    real_outbound_count: 0,
  }));
  process.exitCode = 1;
});
