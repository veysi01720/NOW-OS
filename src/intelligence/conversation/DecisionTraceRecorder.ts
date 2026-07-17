import type { Logger } from "../../observability/logger.js";
import type { ConversationDecision, ConversationDecisionContext } from "./ConversationDecisionSchema.js";

export function recordDecisionTrace(input: {
  logger: Logger;
  context: ConversationDecisionContext;
  decision: ConversationDecision;
  validationReasons: string[];
  qualityReasons: string[];
  statePatchReasons: string[];
  finalReplyOrigin: string;
  modelCallCount: number;
  replyMutatedAfterModel: boolean;
  mutationSource: string | null;
  behaviorPromptVersion: string;
}): void {
  input.logger.info({
    event_type: "CONVERSATION_DECISION_V2_TRACE",
    correlation_id: input.context.request_id,
    role: input.context.role,
    channel: input.context.channel,
    dialogue_phase: input.context.derived_state.dialogue_phase,
    intent: input.decision.intent.primary,
    direct_question_present: input.decision.direct_question.present,
    direct_question_answered: input.decision.direct_question.answered_in_reply,
    chosen_actions: input.decision.chosen_actions,
    next_action: input.decision.next_action,
    policy_fact_ids: input.decision.policy_facts_used,
    model_call_count: input.modelCallCount,
    behavior_prompt_version: input.behaviorPromptVersion,
    validation_reason_codes: input.validationReasons,
    quality_reason_codes: input.qualityReasons,
    state_patch_reason_codes: input.statePatchReasons,
    final_reply_origin: input.finalReplyOrigin,
    reply_origin: input.decision.origin ?? "conversation_decision_v2",
    reply_mutated_after_model: input.replyMutatedAfterModel,
    mutation_source: input.mutationSource,
    raw_text_logged: false
  });
}
