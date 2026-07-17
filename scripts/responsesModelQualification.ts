import { createOpenAIResponsesAdapter } from "../src/modelAdapter/ResponsesAdapter.js";
import { qualifyConfiguredResponsesModel } from "../src/modelAdapter/responsesModelQualification.js";

async function main(): Promise<void> {
  const apiKeyPresent = Boolean(process.env.OPENAI_API_KEY);
  const model = process.env.OPENAI_RESPONSES_MODEL?.trim();
  const realQualificationEnabled = process.env.RESPONSES_QUALIFICATION_REAL === "true";
  if (!realQualificationEnabled) {
    console.log(JSON.stringify({
      status: "SKIPPED_REAL_CALL",
      reason: "explicit_flag_required",
      api_key_present: apiKeyPresent,
      model_configured: Boolean(model),
      secrets_printed: false,
      raw_output_logged: false,
      real_outbound_count: 0,
    }));
    return;
  }
  if (!apiKeyPresent || !model) {
    console.log(JSON.stringify({
      status: "SKIPPED_MISSING_CONFIG",
      api_key_present: apiKeyPresent,
      model_configured: Boolean(model),
      secrets_printed: false,
      raw_output_logged: false,
      real_outbound_count: 0,
    }));
    return;
  }

  const adapter = await createOpenAIResponsesAdapter({ apiKey: process.env.OPENAI_API_KEY!, model });
  const report = await qualifyConfiguredResponsesModel({
    configuredModelPresent: true,
    adapterFactory: () => adapter,
  });

  const compact = {
    status: report.classification,
    configured_model: model,
    baseline_runs: report.baseline.reports.map((run) => ({
      passed: run.scenarios_passed,
      total: run.scenarios_total,
      schema_rate: run.valid_schema_rate,
      unsafe_claim_count: run.unsafe_claim_count,
      failed_ids: run.results.filter((result) => !result.passed).map((result) => result.id),
      failed_reasons: Object.fromEntries(run.results.filter((result) => !result.passed).map((result) => [result.id, result.reason_codes])),
    })),
    expanded_runs: report.expanded.reports.map((run) => ({
      passed: run.scenarios_passed,
      total: run.scenarios_total,
      schema_rate: run.valid_schema_rate,
      unsafe_claim_count: run.unsafe_claim_count,
      failed_ids: run.results.filter((result) => !result.passed).map((result) => result.id),
      failed_reasons: Object.fromEntries(run.results.filter((result) => !result.passed).map((result) => [result.id, result.reason_codes])),
    })),
    safety_violations_total: report.safety_violations_total,
    package_12b_required: report.package_12b_required,
    owner_approval_required_for_model_switch: true,
    raw_output_logged: false,
    secrets_printed: false,
    real_outbound_count: 0,
  };
  console.log(JSON.stringify(compact));
  if (report.classification !== "ELIGIBLE_FOR_OWNER_REVIEW") process.exitCode = 1;
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
