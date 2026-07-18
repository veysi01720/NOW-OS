export interface ModelAdapterCanaryTerminalObservation {
  unsafe_claim_count: number;
  internal_or_raw_output_outbound_count: number;
  sensitive_log_count: number;
  unauthorized_path_count: number;
  outbound_count_mismatch_count: number;
  hash_mismatch_count: number;
  invalid_transition_applied_count: number;
  fake_link_promoted_count: number;
  safe_fallback_count: number;
  validator_reject_count: number;
  schema_or_parse_reject_count: number;
  final_provider_failure_count: number;
  terminal_failure_count: number;
  model_origin_accepted_count: number;
  transient_retry_count: number;
  timeout_before_retry_count: number;
  latency_ms: number;
}

export type ModelAdapterCanaryThresholdId =
  | "unsafe_claim_count"
  | "internal_or_raw_output_outbound"
  | "sensitive_log"
  | "unauthorized_path"
  | "outbound_count_mismatch"
  | "hash_mismatch"
  | "invalid_transition_applied"
  | "fake_link_promoted"
  | "safe_fallback_rate"
  | "validator_reject_rate"
  | "schema_or_parse_reject_rate"
  | "final_provider_failure_rate"
  | "terminal_failure_rate"
  | "model_origin_acceptance_rate"
  | "sustained_transient_retry_rate"
  | "sustained_p95_latency"
  | "sustained_timeout_rate";

export interface ModelAdapterCanaryThresholdDecision {
  stop: boolean;
  immediate: boolean;
  threshold_ids: ModelAdapterCanaryThresholdId[];
  sample_size: number;
}

interface WindowEvaluation {
  thresholdIds: ModelAdapterCanaryThresholdId[];
  transientRetryDegraded: boolean;
  latencyDegraded: boolean;
  timeoutDegraded: boolean;
}

function sum(
  observations: ModelAdapterCanaryTerminalObservation[],
  key: keyof ModelAdapterCanaryTerminalObservation,
): number {
  return observations.reduce((total, observation) => total + observation[key], 0);
}

function percentile95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

function immediateThresholds(observation: ModelAdapterCanaryTerminalObservation): ModelAdapterCanaryThresholdId[] {
  const ids: ModelAdapterCanaryThresholdId[] = [];
  if (observation.unsafe_claim_count >= 1) ids.push("unsafe_claim_count");
  if (observation.internal_or_raw_output_outbound_count >= 1) ids.push("internal_or_raw_output_outbound");
  if (observation.sensitive_log_count >= 1) ids.push("sensitive_log");
  if (observation.unauthorized_path_count >= 1) ids.push("unauthorized_path");
  if (observation.outbound_count_mismatch_count >= 1) ids.push("outbound_count_mismatch");
  if (observation.hash_mismatch_count >= 1) ids.push("hash_mismatch");
  if (observation.invalid_transition_applied_count >= 1) ids.push("invalid_transition_applied");
  if (observation.fake_link_promoted_count >= 1) ids.push("fake_link_promoted");
  return ids;
}

function evaluateWindow(observations: ModelAdapterCanaryTerminalObservation[]): WindowEvaluation {
  const total = observations.length;
  const thresholdIds: ModelAdapterCanaryThresholdId[] = [];
  if (sum(observations, "safe_fallback_count") / total > 0.05) thresholdIds.push("safe_fallback_rate");
  if (sum(observations, "validator_reject_count") / total > 0.10) thresholdIds.push("validator_reject_rate");
  if (sum(observations, "schema_or_parse_reject_count") / total > 0.02) thresholdIds.push("schema_or_parse_reject_rate");
  if (sum(observations, "final_provider_failure_count") / total > 0.05) thresholdIds.push("final_provider_failure_rate");
  if (sum(observations, "terminal_failure_count") / total > 0.05) thresholdIds.push("terminal_failure_rate");
  if (sum(observations, "model_origin_accepted_count") / total < 0.90) thresholdIds.push("model_origin_acceptance_rate");
  return {
    thresholdIds,
    transientRetryDegraded: sum(observations, "transient_retry_count") / total > 0.20,
    latencyDegraded: percentile95(observations.map((observation) => observation.latency_ms)) > 12_000,
    timeoutDegraded: sum(observations, "timeout_before_retry_count") / total > 0.10,
  };
}

export class ModelAdapterCanaryThresholdEvaluator {
  private currentWindow: ModelAdapterCanaryTerminalObservation[] = [];
  private previousWindow: WindowEvaluation | null = null;

  evaluate(observation: ModelAdapterCanaryTerminalObservation): ModelAdapterCanaryThresholdDecision {
    const immediate = immediateThresholds(observation);
    if (immediate.length > 0) {
      return { stop: true, immediate: true, threshold_ids: immediate, sample_size: 1 };
    }

    this.currentWindow.push({ ...observation });
    if (this.currentWindow.length < 20) {
      return { stop: false, immediate: false, threshold_ids: [], sample_size: this.currentWindow.length };
    }

    const window = evaluateWindow(this.currentWindow);
    const thresholdIds = [...window.thresholdIds];
    if (this.previousWindow?.transientRetryDegraded && window.transientRetryDegraded) {
      thresholdIds.push("sustained_transient_retry_rate");
    }
    if (this.previousWindow?.latencyDegraded && window.latencyDegraded) {
      thresholdIds.push("sustained_p95_latency");
    }
    if (this.previousWindow?.timeoutDegraded && window.timeoutDegraded) {
      thresholdIds.push("sustained_timeout_rate");
    }
    this.previousWindow = window;
    this.currentWindow = [];
    return { stop: thresholdIds.length > 0, immediate: false, threshold_ids: thresholdIds, sample_size: 20 };
  }
}

export function emptyModelAdapterCanaryObservation(): ModelAdapterCanaryTerminalObservation {
  return {
    unsafe_claim_count: 0,
    internal_or_raw_output_outbound_count: 0,
    sensitive_log_count: 0,
    unauthorized_path_count: 0,
    outbound_count_mismatch_count: 0,
    hash_mismatch_count: 0,
    invalid_transition_applied_count: 0,
    fake_link_promoted_count: 0,
    safe_fallback_count: 0,
    validator_reject_count: 0,
    schema_or_parse_reject_count: 0,
    final_provider_failure_count: 0,
    terminal_failure_count: 0,
    model_origin_accepted_count: 1,
    transient_retry_count: 0,
    timeout_before_retry_count: 0,
    latency_ms: 0,
  };
}
