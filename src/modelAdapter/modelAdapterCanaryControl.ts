import { createHash } from "node:crypto";
import type { Logger } from "../observability/logger.js";
import { ModelAdapterCanaryApprovalStore } from "./modelAdapterCanaryApproval.js";
import {
  ModelAdapterCanaryThresholdEvaluator,
  type ModelAdapterCanaryTerminalObservation,
  type ModelAdapterCanaryThresholdId,
} from "./modelAdapterCanaryThresholds.js";

export type ModelAdapterCanaryReservationStatus =
  | "reserved"
  | "already_reserved"
  | "duplicate"
  | "denied_stop_latched"
  | "denied_approval_invalid"
  | "denied_budget_exhausted";

export interface ModelAdapterCanaryFinalizeResult {
  status: "finalized" | "already_finalized" | "not_reserved";
  egress_allowed: boolean;
  stop_triggered: boolean;
  effective_canary_mode: "off";
  threshold_ids: ModelAdapterCanaryThresholdId[];
}

interface Reservation {
  event_key_hash: string;
  finalized: boolean;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class ModelAdapterCanaryControl {
  private stopLatched = false;
  private stopReason: ModelAdapterCanaryThresholdId | null = null;
  private reservations = new Map<string, Reservation>();
  private terminalObservationCount = 0;

  constructor(
    private readonly approvals: ModelAdapterCanaryApprovalStore,
    private readonly evaluator: ModelAdapterCanaryThresholdEvaluator,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {
    const approval = this.approvals.read();
    const reason = approval?.invalidation_reason;
    if (approval?.invalidated_at && reason && this.isThresholdId(reason)) {
      this.stopLatched = true;
      this.stopReason = reason;
    }
  }

  effectiveMode(configuredMode: "off" | "internal" | "tenant_allowlist"): "off" | "internal" | "tenant_allowlist" {
    return this.stopLatched || !this.approvals.isValid(this.now()) ? "off" : configuredMode;
  }

  reserve(eventKey: string): ModelAdapterCanaryReservationStatus {
    if (this.stopLatched) return "denied_stop_latched";
    if (!this.approvals.isValid(this.now())) return "denied_approval_invalid";
    const eventKeyHash = hash(eventKey);
    const existing = this.reservations.get(eventKeyHash);
    if (existing) return existing.finalized ? "duplicate" : "already_reserved";
    const approval = this.approvals.read();
    if (!approval || this.reservations.size >= approval.maximum_observed_messages) {
      return "denied_budget_exhausted";
    }
    this.reservations.set(eventKeyHash, { event_key_hash: eventKeyHash, finalized: false });
    this.logger.info({
      event_type: "MODEL_ADAPTER_CANARY_RESERVED",
      event_key_hash: eventKeyHash,
      reservation_count: this.reservations.size,
      raw_text_logged: false,
    });
    return "reserved";
  }

  finalize(eventKey: string, observation: ModelAdapterCanaryTerminalObservation): ModelAdapterCanaryFinalizeResult {
    const eventKeyHash = hash(eventKey);
    const reservation = this.reservations.get(eventKeyHash);
    if (!reservation) {
      return { status: "not_reserved", egress_allowed: true, stop_triggered: false, effective_canary_mode: "off", threshold_ids: [] };
    }
    if (reservation.finalized) {
      return {
        status: "already_finalized",
        egress_allowed: !this.stopLatched,
        stop_triggered: this.stopLatched,
        effective_canary_mode: "off",
        threshold_ids: this.stopReason ? [this.stopReason] : [],
      };
    }

    reservation.finalized = true;
    this.terminalObservationCount += 1;
    const decision = this.evaluator.evaluate(observation);
    if (decision.stop && !this.stopLatched) {
      this.stopLatched = true;
      this.stopReason = decision.threshold_ids[0] ?? null;
      this.approvals.invalidate(this.stopReason ?? "threshold_stop", this.now());
      this.logger.error({
        event_type: "MODEL_ADAPTER_CANARY_AUTOMATIC_STOP",
        event_key_hash: eventKeyHash,
        threshold_ids: decision.threshold_ids,
        immediate: decision.immediate,
        effective_canary_mode: "off",
        approval_invalidated: true,
        egress_allowed: !decision.immediate,
        raw_text_logged: false,
      });
    }
    return {
      status: "finalized",
      egress_allowed: !(decision.stop && decision.immediate),
      stop_triggered: decision.stop,
      effective_canary_mode: "off",
      threshold_ids: decision.threshold_ids,
    };
  }

  snapshot(): {
    automatic_stop_code_active: true;
    stop_latched: boolean;
    stop_reason: ModelAdapterCanaryThresholdId | null;
    effective_canary_mode: "off";
    approval_valid: boolean;
    reservation_count: number;
    terminal_observation_count: number;
  } {
    return {
      automatic_stop_code_active: true,
      stop_latched: this.stopLatched,
      stop_reason: this.stopReason,
      effective_canary_mode: "off",
      approval_valid: this.approvals.isValid(this.now()),
      reservation_count: this.reservations.size,
      terminal_observation_count: this.terminalObservationCount,
    };
  }

  private isThresholdId(value: string): value is ModelAdapterCanaryThresholdId {
    return [
      "unsafe_claim_count",
      "internal_or_raw_output_outbound",
      "sensitive_log",
      "unauthorized_path",
      "outbound_count_mismatch",
      "hash_mismatch",
      "invalid_transition_applied",
      "fake_link_promoted",
      "safe_fallback_rate",
      "validator_reject_rate",
      "schema_or_parse_reject_rate",
      "final_provider_failure_rate",
      "terminal_failure_rate",
      "model_origin_acceptance_rate",
      "sustained_transient_retry_rate",
      "sustained_p95_latency",
      "sustained_timeout_rate",
    ].includes(value);
  }
}
