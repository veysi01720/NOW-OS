import type { ConversationDecision, ConversationDecisionAction } from "./ConversationDecisionSchema.js";
import type { ConversationDecisionV3 } from "./ConversationDecisionV3Schema.js";

// Keeps the provider-neutral V3 contract intact while feeding the existing backend transition boundary.
export function mapConversationDecisionV3ToBackendDecision(
  decision: ConversationDecisionV3,
  origin: ConversationDecision["origin"],
): ConversationDecision {
  const chosenActions = decision.chosen_actions as ConversationDecisionAction[];
  return {
    decision_version: "2.0",
    intent: decision.intent,
    direct_question: decision.direct_question,
    reply: decision.reply,
    chosen_actions: chosenActions,
    state_patch: {
      age: decision.state_patch.age,
      gender: decision.state_patch.gender,
      daily_hours: decision.state_patch.daily_hours,
      work_model_acceptance: decision.state_patch.work_model_acceptance,
      selected_app: decision.state_patch.selected_app,
      phone_type: decision.state_patch.phone_type,
      work_model_disclosed: decision.state_patch.work_model_disclosed ?? undefined,
      preferred_work_mode: decision.state_patch.preferred_work_mode,
      video_allowed: decision.state_patch.video_allowed,
    },
    state_patch_evidence: decision.state_patch_evidence.map((evidence) => ({ ...evidence })),
    policy_facts_used: decision.policy_facts_used,
    next_action: decision.next_action,
    requires_escalation: decision.requires_escalation,
    escalation_reason: decision.escalation_reason,
    risk_flags: decision.risk_flags,
    self_check: decision.self_check,
    origin,
  };
}
