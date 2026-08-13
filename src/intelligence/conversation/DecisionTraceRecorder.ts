import type { Logger } from "../../observability/logger.js";
import type { ConversationDecision, ConversationDecisionContext } from "./ConversationDecisionSchema.js";
import { splitValidatorReasonCodes } from "./ConversationValidatorReasonCatalog.js";

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
  layer1Result?: "pass" | "fail" | null;
  layer1ReasonCodes?: string[];
  layer2Result?: "pass" | "accepted_with_variance" | "fail" | null;
  layer2ReasonCodes?: string[];
  repairAttempted?: boolean;
  semanticQuestionAnswered?: boolean | null;
}): void {
  // Keep trace severity derived from the explicit catalog, including quality and
  // state-patch validators. The semantic validator is not the only producer.
  const categorized = splitValidatorReasonCodes([
    ...input.validationReasons,
    ...input.qualityReasons,
    ...input.statePatchReasons,
    ...(input.layer1ReasonCodes ?? []),
    ...(input.layer2ReasonCodes ?? []),
  ]);
  const layer1ReasonCodes = [...new Set(categorized.layer_1_reason_codes)];
  const layer2ReasonCodes = [...new Set(categorized.layer_2_reason_codes)];
  const layer1Result = layer1ReasonCodes.length > 0 ? "fail" : (input.layer1Result ?? "pass");
  const layer2Result = layer2ReasonCodes.length > 0
    ? (input.layer2Result === "accepted_with_variance" ? "accepted_with_variance" : (input.layer2Result ?? "fail"))
    : (input.layer2Result ?? "pass");

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
    layer_1_result: layer1Result,
    layer_1_reason_codes: layer1ReasonCodes,
    layer_2_result: layer2Result,
    layer_2_reason_codes: layer2ReasonCodes,
    repair_attempted: input.repairAttempted ?? false,
    semantic_question_answered: input.semanticQuestionAnswered ?? null,
    raw_text_logged: false
  });
}
