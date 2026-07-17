import { randomUUID } from "node:crypto";
import type { SenderRole } from "../config/roles.js";
import type { ChatType } from "../contracts/backendContextPayload.js";
import type { BehaviorCanaryMode, BehaviorEligibilityReason } from "./behaviorCanaryEligibility.js";
import type { ConversationalQualityContract } from "./types.js";

export type BehaviorCanaryPathUsed = "legacy" | "behavior";
export type BehaviorCanaryTerminalOutcome =
  | "success"
  | "legacy_fallback"
  | "contract_failure"
  | "quality_failure"
  | "model_execution_error"
  | "cancelled"
  | "timeout";

export interface BehaviorPlanSnapshot {
  answer_scope?: string;
  length_budget?: string;
  use_history?: boolean;
  repetition_avoidance?: boolean;
  escalation_required?: boolean;
  confidence_category?: string;
}

export interface BehaviorCanaryObservation {
  execution_id: string;
  eligible: boolean;
  eligibility_reason: BehaviorEligibilityReason | string;
  canary_mode: BehaviorCanaryMode;
  path_used: BehaviorCanaryPathUsed;
  conversation_type: ChatType;
  sender_role_category: "owner" | "manager" | "normal" | "unknown";
  primary_intent?: string;
  answer_scope?: string;
  length_budget?: string;
  confidence_category?: string;
  contract_valid: boolean;
  quality_valid: boolean;
  reply_present: boolean;
  internal_note_present: boolean;
  repetition_detected?: boolean;
  unnecessary_greeting_detected?: boolean;
  excessive_length_detected?: boolean;
  escalation_required?: boolean;
  terminal_outcome: BehaviorCanaryTerminalOutcome;
  legacy_plan_snapshot?: BehaviorPlanSnapshot;
  behavior_plan_snapshot?: BehaviorPlanSnapshot;
}

export interface BehaviorCanaryCounters {
  behavior_canary_eligible_total: number;
  behavior_canary_denied_total: number;
  behavior_path_used_total: number;
  behavior_legacy_fallback_total: number;
  behavior_contract_failure_total: number;
  behavior_quality_failure_total: number;
  behavior_internal_note_blocked_total: number;
  behavior_excessive_length_total: number;
  behavior_repetition_detected_total: number;
  behavior_escalation_total: number;
}

export function createBehaviorCanaryExecutionId(): string {
  return `bcan_${randomUUID()}`;
}

export function roleCategory(role: SenderRole | undefined): BehaviorCanaryObservation["sender_role_category"] {
  if (role === "owner" || role === "manager") return role;
  if (role === "candidate" || role === "publisher" || role === "support") return "normal";
  return "unknown";
}

export function planSnapshotFromQuality(quality?: ConversationalQualityContract): BehaviorPlanSnapshot | undefined {
  if (!quality) return undefined;
  return {
    answer_scope: quality.answerScope,
    length_budget: quality.lengthBudget,
    use_history: quality.useConversationHistory,
    repetition_avoidance: quality.avoidRepetition,
    escalation_required: quality.escalationRequired,
    confidence_category: quality.confidence,
  };
}

export function createBehaviorCanaryObservation(input: {
  eligible: boolean;
  eligibilityReason: BehaviorEligibilityReason | string;
  canaryMode: BehaviorCanaryMode;
  conversationType: ChatType;
  senderRole: SenderRole | undefined;
  quality?: ConversationalQualityContract;
  contractValid: boolean;
  qualityValid: boolean;
  replyPresent: boolean;
  internalNotePresent: boolean;
  terminalOutcome: BehaviorCanaryTerminalOutcome;
  legacyPlanSnapshot?: BehaviorPlanSnapshot;
}): BehaviorCanaryObservation {
  const behaviorPlanSnapshot = planSnapshotFromQuality(input.quality);
  const excessiveLength =
    input.quality?.lengthBudget === "very_short" && input.quality.answerScope !== "direct_answer"
      ? false
      : undefined;
  return {
    execution_id: createBehaviorCanaryExecutionId(),
    eligible: input.eligible,
    eligibility_reason: input.eligibilityReason,
    canary_mode: input.canaryMode,
    path_used: input.eligible ? "behavior" : "legacy",
    conversation_type: input.conversationType,
    sender_role_category: roleCategory(input.senderRole),
    primary_intent: input.quality?.primaryIntent,
    answer_scope: input.quality?.answerScope,
    length_budget: input.quality?.lengthBudget,
    confidence_category: input.quality?.confidence,
    contract_valid: input.contractValid,
    quality_valid: input.qualityValid,
    reply_present: input.replyPresent,
    internal_note_present: input.internalNotePresent,
    repetition_detected: input.quality?.avoidRepetition,
    unnecessary_greeting_detected: false,
    excessive_length_detected: excessiveLength,
    escalation_required: input.quality?.escalationRequired,
    terminal_outcome: input.terminalOutcome,
    legacy_plan_snapshot: input.legacyPlanSnapshot,
    behavior_plan_snapshot: behaviorPlanSnapshot,
  };
}

export function countersFromObservation(observation: BehaviorCanaryObservation): BehaviorCanaryCounters {
  return {
    behavior_canary_eligible_total: observation.eligible ? 1 : 0,
    behavior_canary_denied_total: observation.eligible ? 0 : 1,
    behavior_path_used_total: observation.path_used === "behavior" ? 1 : 0,
    behavior_legacy_fallback_total: observation.terminal_outcome === "legacy_fallback" ? 1 : 0,
    behavior_contract_failure_total: observation.terminal_outcome === "contract_failure" ? 1 : 0,
    behavior_quality_failure_total: observation.terminal_outcome === "quality_failure" ? 1 : 0,
    behavior_internal_note_blocked_total: observation.internal_note_present && !observation.quality_valid ? 1 : 0,
    behavior_excessive_length_total: observation.excessive_length_detected ? 1 : 0,
    behavior_repetition_detected_total: observation.repetition_detected ? 1 : 0,
    behavior_escalation_total: observation.escalation_required ? 1 : 0,
  };
}

export function isBehaviorCanaryRollbackRequired(observation: BehaviorCanaryObservation): boolean {
  return (
    (observation.path_used === "behavior" && observation.sender_role_category === "normal") ||
    (observation.path_used === "behavior" && observation.conversation_type === "group") ||
    observation.terminal_outcome === "contract_failure" ||
    observation.terminal_outcome === "quality_failure"
  );
}
