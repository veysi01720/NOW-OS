import { deriveCandidateState } from "../../bridge/candidateIntakeStateMachine.js";
import type { UserState } from "../../storage/types.js";
import {
  validateConversationDecisionV3Semantics,
  type ConversationDecisionV3SemanticContext,
} from "./ConversationDecisionV3SemanticValidator.js";
import type {
  ConversationDecisionV3,
  ConversationDecisionV3StatePatchField,
} from "./ConversationDecisionV3Schema.js";

export type ConversationDecisionV3TransitionKind =
  | "none"
  | "candidate_state_preview"
  | "missing_info_question"
  | "missing_info_escalation"
  | "support_followup";

export interface ConversationDecisionV3TransitionProposal {
  non_mutating: true;
  valid: boolean;
  transition_kind: ConversationDecisionV3TransitionKind;
  reason_codes: string[];
  current_state: UserState;
  proposed_state: UserState;
  changed_fields: string[];
  captured_fields: ConversationDecisionV3StatePatchField[];
  expected_next_step: string;
  missing_fields_before: string[];
  missing_fields_after: string[];
  state_write_count: 0;
  outbound_count: 0;
}

export type CandidateLockResult<T> =
  | { acquired: true; value: T }
  | { acquired: false; reason: "candidate_transition_in_progress" };

function cloneState(state: UserState): UserState {
  return {
    ...state,
    missing_fields: [...state.missing_fields],
    ...(state.behavior_conversation_state
      ? {
          behavior_conversation_state: {
            ...state.behavior_conversation_state,
            unresolvedObjections: [...state.behavior_conversation_state.unresolvedObjections],
            completedTopics: [...state.behavior_conversation_state.completedTopics],
            pendingTopics: [...state.behavior_conversation_state.pendingTopics],
          },
        }
      : {}),
  };
}

function changedFields(previous: UserState, next: UserState): string[] {
  const fields: Array<keyof UserState> = [
    "current_state",
    "selected_app",
    "phone_type",
    "age",
    "gender",
    "daily_hours",
    "eligibility_status",
    "work_model_disclosed",
    "model_acceptance",
    "installation_status",
    "training_status",
    "expected_next_step",
    "behavior_conversation_state",
  ];
  const changed = fields.filter((field) => JSON.stringify(previous[field]) !== JSON.stringify(next[field]));
  if (
    previous.missing_fields.length !== next.missing_fields.length ||
    previous.missing_fields.some((field, index) => field !== next.missing_fields[index])
  ) {
    changed.push("missing_fields");
  }
  return [...new Set(changed.map(String))];
}

function patchFields(decision: ConversationDecisionV3): ConversationDecisionV3StatePatchField[] {
  return (Object.entries(decision.state_patch) as Array<[
    ConversationDecisionV3StatePatchField,
    ConversationDecisionV3["state_patch"][ConversationDecisionV3StatePatchField],
  ]>)
    .filter(([, value]) => value !== null)
    .map(([field]) => field);
}

function applyPatchPreview(current: UserState, decision: ConversationDecisionV3): UserState {
  const next = cloneState(current);
  const patch = decision.state_patch;

  if (patch.age !== null) next.age = patch.age;
  if (patch.gender !== null) next.gender = patch.gender;
  if (patch.daily_hours !== null) next.daily_hours = patch.daily_hours;
  if (patch.selected_app !== null) next.selected_app = patch.selected_app;
  if (patch.phone_type !== null) next.phone_type = patch.phone_type;
  if (patch.work_model_disclosed !== null) next.work_model_disclosed = patch.work_model_disclosed;
  if (patch.work_model_acceptance !== null) next.model_acceptance = patch.work_model_acceptance;

  const behaviorPreview = patch.preferred_work_mode !== null || patch.video_allowed !== null
    ? {
      tenantId: next.behavior_conversation_state?.tenantId ?? "transition_preview",
      conversationId: next.behavior_conversation_state?.conversationId ?? "transition_preview",
      channelType: next.behavior_conversation_state?.channelType ?? "private",
      currentMode: next.behavior_conversation_state?.currentMode ?? "candidate",
      userStage: next.behavior_conversation_state?.userStage ?? next.current_state,
      lastResolvedIntent: next.behavior_conversation_state?.lastResolvedIntent ?? decision.intent.primary,
      unresolvedObjections: [...(next.behavior_conversation_state?.unresolvedObjections ?? [])],
      completedTopics: [...(next.behavior_conversation_state?.completedTopics ?? [])],
      pendingTopics: [...(next.behavior_conversation_state?.pendingTopics ?? next.missing_fields)],
      lastAssistantAction: next.behavior_conversation_state?.lastAssistantAction ?? decision.next_action,
      lastUserSentiment: next.behavior_conversation_state?.lastUserSentiment ?? "neutral",
      escalationStatus: next.behavior_conversation_state?.escalationStatus ?? "none",
      summary: next.behavior_conversation_state?.summary ?? "",
      textOnlyPreference: patch.preferred_work_mode === "text_only"
        ? true
        : next.behavior_conversation_state?.textOnlyPreference,
      preferredWorkMode: patch.preferred_work_mode ?? next.behavior_conversation_state?.preferredWorkMode,
      videoAllowed: patch.video_allowed ?? next.behavior_conversation_state?.videoAllowed,
      updatedAt: next.behavior_conversation_state?.updatedAt ?? "transition_preview",
    }
    : undefined;

  const derived = deriveCandidateState(next);
  if (behaviorPreview !== undefined) derived.behavior_conversation_state = behaviorPreview;
  return derived;
}

function baseProposal(
  current: UserState,
  proposed: UserState,
  valid: boolean,
  transitionKind: ConversationDecisionV3TransitionKind,
  reasons: string[],
  capturedFields: ConversationDecisionV3StatePatchField[],
): ConversationDecisionV3TransitionProposal {
  return {
    non_mutating: true,
    valid,
    transition_kind: transitionKind,
    reason_codes: [...new Set(reasons)],
    current_state: cloneState(current),
    proposed_state: cloneState(proposed),
    changed_fields: changedFields(current, proposed),
    captured_fields: [...capturedFields],
    expected_next_step: proposed.expected_next_step,
    missing_fields_before: [...current.missing_fields],
    missing_fields_after: [...proposed.missing_fields],
    state_write_count: 0,
    outbound_count: 0,
  };
}

function transitionKindFor(decision: ConversationDecisionV3, capturedFields: ConversationDecisionV3StatePatchField[]): ConversationDecisionV3TransitionKind {
  if (decision.next_action === "escalate_missing_info") return "missing_info_escalation";
  if (decision.next_action === "ask_missing_info") return "missing_info_question";
  if (decision.next_action === "enqueue_followup" || decision.chosen_actions.includes("handle_user_frustration")) return "support_followup";
  if (decision.next_action === "update_candidate_state" || capturedFields.length > 0) return "candidate_state_preview";
  return "none";
}

export function prepareConversationDecisionV3Transition(
  decision: ConversationDecisionV3,
  context: ConversationDecisionV3SemanticContext,
): ConversationDecisionV3TransitionProposal {
  const current = cloneState(context.candidate_state);
  const semantic = validateConversationDecisionV3Semantics(decision, context);
  const captured = patchFields(decision);

  if (
    (context.role !== "candidate" || context.channel_type !== "private") &&
    (captured.length > 0 || decision.next_action === "update_candidate_state")
  ) {
    return baseProposal(current, current, false, "none", ["TRANSITION_AUTHORITY_DENIED"], []);
  }

  if (!semantic.ok) {
    return baseProposal(current, current, false, "none", semantic.reason_codes, []);
  }

  const kind = transitionKindFor(decision, captured);
  const proposed = kind === "candidate_state_preview" ? applyPatchPreview(current, decision) : current;
  const reasons: string[] = [];

  if (kind === "missing_info_escalation" && decision.escalation_reason === null) {
    reasons.push("MISSING_INFO_ESCALATION_REASON_REQUIRED");
  }

  return baseProposal(current, proposed, reasons.length === 0, kind, reasons, captured);
}

export class CandidateTransitionMutex {
  private readonly inFlight = new Set<string>();

  async runExclusive<T>(candidateKey: string, work: () => Promise<T>): Promise<CandidateLockResult<T>> {
    if (this.inFlight.has(candidateKey)) {
      return { acquired: false, reason: "candidate_transition_in_progress" };
    }
    this.inFlight.add(candidateKey);
    try {
      return { acquired: true, value: await work() };
    } finally {
      this.inFlight.delete(candidateKey);
    }
  }

  isLocked(candidateKey: string): boolean {
    return this.inFlight.has(candidateKey);
  }
}
