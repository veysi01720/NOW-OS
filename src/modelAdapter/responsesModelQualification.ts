import type { IModelAdapter } from "./IModelAdapter.js";
import {
  RESPONSES_EXPANDED_SCENARIOS,
  RESPONSES_GOLDEN_SCENARIOS,
  runRepeatedResponsesGoldenReplay,
  type ResponsesGoldenRepeatedReport,
} from "./responsesGoldenReplay.js";

export interface ResponsesModelQualificationReport {
  classification: "ELIGIBLE_FOR_OWNER_REVIEW" | "NOT_ELIGIBLE";
  configured_model_present: boolean;
  baseline: ResponsesGoldenRepeatedReport;
  expanded: ResponsesGoldenRepeatedReport;
  baseline_failed_scenario_ids: string[];
  expanded_failed_scenario_ids: string[];
  safety_violations_total: number;
  real_outbound_count: 0;
  owner_approval_required_for_model_switch: true;
  package_12b_required: boolean;
}

function failedScenarioIds(report: ResponsesGoldenRepeatedReport): string[] {
  return [...new Set(report.reports.flatMap((run) => run.results.filter((result) => !result.passed).map((result) => result.id)))];
}

function schemasValid(report: ResponsesGoldenRepeatedReport): boolean {
  return report.reports.every((run) => run.valid_schema_rate === 1);
}

export function configuredModelIsEligible(input: {
  configuredModelPresent: boolean;
  baseline: ResponsesGoldenRepeatedReport;
  expanded: ResponsesGoldenRepeatedReport;
}): boolean {
  return input.configuredModelPresent
    && input.baseline.all_runs_meet_target
    && input.expanded.all_runs_meet_target
    && schemasValid(input.baseline)
    && schemasValid(input.expanded)
    && input.baseline.unsafe_claim_count_total + input.expanded.unsafe_claim_count_total === 0;
}

export async function qualifyConfiguredResponsesModel(input: {
  adapterFactory: (runIndex: number, suite: "baseline" | "expanded") => IModelAdapter;
  configuredModelPresent: boolean;
  runs?: number;
}): Promise<ResponsesModelQualificationReport> {
  const runs = input.runs ?? 3;
  const baseline = await runRepeatedResponsesGoldenReplay(
    (runIndex) => input.adapterFactory(runIndex, "baseline"),
    { runs, scenarios: RESPONSES_GOLDEN_SCENARIOS, targetPassThreshold: RESPONSES_GOLDEN_SCENARIOS.length },
  );
  const expanded = await runRepeatedResponsesGoldenReplay(
    (runIndex) => input.adapterFactory(runIndex, "expanded"),
    { runs, scenarios: RESPONSES_EXPANDED_SCENARIOS, targetPassThreshold: RESPONSES_EXPANDED_SCENARIOS.length },
  );
  const safetyViolations = baseline.unsafe_claim_count_total + expanded.unsafe_claim_count_total;
  const eligible = configuredModelIsEligible({
    configuredModelPresent: input.configuredModelPresent,
    baseline,
    expanded,
  });

  return {
    classification: eligible ? "ELIGIBLE_FOR_OWNER_REVIEW" : "NOT_ELIGIBLE",
    configured_model_present: input.configuredModelPresent,
    baseline,
    expanded,
    baseline_failed_scenario_ids: failedScenarioIds(baseline),
    expanded_failed_scenario_ids: failedScenarioIds(expanded),
    safety_violations_total: safetyViolations,
    real_outbound_count: 0,
    owner_approval_required_for_model_switch: true,
    package_12b_required: !eligible,
  };
}
