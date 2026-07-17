import type { EnvConfig } from "../../config/env.js";
import type { BackendContextPayloadV1 } from "../../contracts/backendContextPayload.js";
import type { Logger } from "../../observability/logger.js";
import type { UserState } from "../../storage/types.js";
import type { NormalizedIncomingMessage } from "../../bridge/normalizeEvolutionMessage.js";
import type { ModelExecutionService } from "../../modelAdapter/modelExecutionService.js";
import type { ConversationDecision, ConversationDecisionContext } from "./ConversationDecisionSchema.js";
import { buildConversationDecisionContext } from "./ConversationContextBuilder.js";
import { buildDeterministicSafetyDecision } from "./ConversationDecisionRepair.js";
import { parseConversationDecision, validateConversationDecision } from "./ConversationDecisionValidator.js";
import { validateSemanticQuality } from "../quality/SemanticQualityGuard.js";
import { validateAndApplyStatePatch } from "../candidate/StatePatchValidator.js";
import { recordDecisionTrace } from "./DecisionTraceRecorder.js";

export interface ConversationDecisionEngineResult {
  context: ConversationDecisionContext;
  decision: ConversationDecision;
  finalReply: string;
  nextState: UserState;
  validation_reason_codes: string[];
  quality_reason_codes: string[];
  state_patch_reason_codes: string[];
  origin: string;
  model_call_count: number;
  reply_mutated_after_model: boolean;
  mutation_source: string | null;
  behavior_prompt_version: "conversation_behavior_v2.1";
}

export const CONVERSATION_BEHAVIOR_PROMPT_VERSION = "conversation_behavior_v2.1";

function buildDecisionPrompt(context: ConversationDecisionContext, repairInput?: {
  previousRawText: string;
  reasonCodes: string[];
}): string {
  return [
    `Conversation Decision Engine ${CONVERSATION_BEHAVIOR_PROMPT_VERSION}.`,
    "Return ONLY JSON with decision_version 2.0.",
    "Do not return Assistant Response Contract v1 fields.",
    "Do not return contract_version.",
    "Do not return internal_boss_note.",
    "reply must be an object, never a string.",
    "chosen_actions must be an array.",
    "Required JSON shape:",
    JSON.stringify({
      decision_version: "2.0",
      intent: { primary: "candidate_first_contact", secondary: [], confidence: 0.9 },
      direct_question: { present: false, question_summary: null, answered_in_reply: true },
      reply: { text: "Kısa doğal cevap", language: "tr", tone: "natural_concise", contains_question: true },
      chosen_actions: ["ask_missing_age"],
      state_patch: {},
      policy_facts_used: [],
      next_action: "ask_missing_age",
      requires_escalation: false,
      escalation_reason: null,
      risk_flags: [],
      self_check: {
        answered_latest_message: true,
        asked_known_information_again: false,
        invented_policy: false,
        offered_setup_too_early: false,
        used_generic_closing: false
      }
    }),
    "Answer the latest user message first.",
    "Use only canonical_policy_facts and candidate_state.",
    "Treat canonical_policy_facts as atomic facts, not as a ready-made reply.",
    "Do not ask known age/gender/daily_hours again.",
    "If latest_message.inferred_intent is clarify_previous_explanation, do not repeat the previous assistant reply; explain it in simpler, more concrete words.",
    "If the user says they did not understand, answer the unclear point directly before asking anything.",
    "If latest_message.inferred_intent is ask_job_definition, set intent.primary to ask_job_definition and answer what the work is in concrete terms.",
    "For ask_job_definition, include the user's basic task, the interaction mode, required/optional work mode boundaries, and the next logical step from candidate_state.",
    "For ask_job_definition, mention earnings/points/payment only if canonical_policy_facts include that information; otherwise do not invent it.",
    "For ask_job_definition, do not answer only with 'team will guide', 'ekip yönlendirecek', or 'ekip kontrol etsin'; those are incomplete unless the concrete writing/chat task and next step are also included.",
    "If the user asks about earnings/points/payment but canonical_policy_facts do not contain verified earnings details, say that verified earnings/payment detail is not available instead of inventing it, then still answer the high-level work model and next step.",
    "If the user says they do not understand what the work is, simplify the same concrete work model instead of escalating to the team.",
    "Never end with generic conversation closers like 'Başka sormak istediğin var mı?' or similar.",
    "Use at most one question.",
    "Do not offer setup, link, invite code, phone setup or profile setup before work_model_acceptance=accepted.",
    "Do not use generic closings.",
    "Do not invent account/profile/platform rules not present in canonical_policy_facts.",
    repairInput ? `Repair required. Previous output failed reason codes: ${repairInput.reasonCodes.join(", ")}` : "",
    repairInput?.reasonCodes.includes("JOB_EXPLANATION_INCOMPLETE")
      ? [
          "For JOB_EXPLANATION_INCOMPLETE repair, reply.text must satisfy all checklist items:",
          "1) State the concrete user task: answering/replying to chat/messages in writing.",
          "2) State the work-mode boundary: camera/video is not presented as required; text/chat-oriented work is allowed when grounded.",
          "3) State the next step from current candidate_state: ask missing age, gender, and/or daily availability if they are still missing; otherwise ask for work-model acceptance.",
          "4) Do not add earnings/payment details unless canonical_policy_facts explicitly contain them.",
          "5) If earnings/payment is asked but not grounded, explicitly mark that detail as unverified, then continue with the concrete work-model answer.",
          "6) Do not answer only with team guidance or ekip kontrol; concrete task + mode boundary + next step are mandatory.",
          "7) Do not end with a generic closer."
        ].join("\n")
      : "",
    repairInput?.reasonCodes.includes("UNGROUNDED_APP_SELECTION")
      ? "For UNGROUNDED_APP_SELECTION repair, remove app/platform names unless they are explicitly present in canonical_policy_facts or candidate_state.selected_app."
      : "",
    repairInput?.reasonCodes.includes("GENERIC_CONVERSATION_CLOSER")
      ? "For GENERIC_CONVERSATION_CLOSER repair, remove the generic closing and replace it with the concrete next operational step only."
      : "",
    repairInput ? "<previous_model_output>" : "",
    repairInput ? repairInput.previousRawText : "",
    repairInput ? "</previous_model_output>" : "",
    "",
    "<conversation_decision_context_json>",
    JSON.stringify(context),
    "</conversation_decision_context_json>"
  ].join("\n");
}

async function runModelDecision(input: {
  modelExecutionService: ModelExecutionService;
  backendContext: BackendContextPayloadV1;
  context: ConversationDecisionContext;
  env: EnvConfig;
  repairInput?: {
    previousRawText: string;
    reasonCodes: string[];
  };
}): Promise<{ decision: ConversationDecision | null; rawText: string }> {
  const payload = {
    ...input.backendContext,
    conversation_decision_v2: input.context,
    conversation_decision_v2_instructions: buildDecisionPrompt(input.context, input.repairInput)
  } as BackendContextPayloadV1;

  const modelOutput = await input.modelExecutionService.execute({
    tenantId: "now_os",
    conversationId: input.context.request_id,
    mode: "conversation_decision_v2",
    senderRole: input.backendContext.sender_role,
    channelType: input.backendContext.chat_type,
    normalizedUserMessage: buildDecisionPrompt(input.context, input.repairInput),
    contextPayload: payload,
    retrievedKnowledge: input.backendContext.answer_plan
      ? {
          sourceCount: input.backendContext.answer_plan.source_count,
          ruleIds: input.backendContext.answer_plan.relevant_knowledge_rules
        }
      : undefined,
    responseContractVersion: "1.0",
    metadata: {
      traceId: input.context.request_id,
      knowledgeVersion: input.backendContext.versions.knowledge_base_version,
      featureFlags: {
        behavior_orchestrator_enabled: false,
        model_adapter_layer_enabled: input.env.modelAdapterLayerEnabled,
        model_adapter_canary_mode: input.env.modelAdapterCanaryMode,
        model_adapter_canary_tenants: input.env.modelAdapterCanaryTenants,
        model_adapter_canary_roles: input.env.modelAdapterCanaryRoles
      }
    }
  });

  const decision = parseConversationDecision(modelOutput.rawText);
  if (decision) {
    decision.origin = input.repairInput ? "conversation_decision_v2_model_repair" : "conversation_decision_v2_model";
  }
  return { decision, rawText: modelOutput.rawText };
}

export async function executeConversationDecisionV2(input: {
  message: NormalizedIncomingMessage;
  backendContext: BackendContextPayloadV1;
  capturedFields: string[];
  env: EnvConfig;
  modelExecutionService: ModelExecutionService;
  logger: Logger;
}): Promise<ConversationDecisionEngineResult> {
  const context = buildConversationDecisionContext({
    message: input.message,
    backendContext: input.backendContext,
    env: input.env,
    capturedFields: input.capturedFields
  });

  let decision: ConversationDecision | null = null;
  let rawModelOutput = "";
  let validationReasons: string[] = [];
  let qualityReasons: string[] = [];
  let modelCallCount = 0;
  let replyMutatedAfterModel = false;
  let mutationSource: string | null = null;

  try {
    if (!decision) {
      modelCallCount += 1;
      const modelResult = await runModelDecision({
        modelExecutionService: input.modelExecutionService,
        backendContext: input.backendContext,
        context,
        env: input.env
      });
      decision = modelResult.decision;
      rawModelOutput = modelResult.rawText;
    }
  } catch (error) {
    input.logger.warn({
      event_type: "CONVERSATION_DECISION_V2_MODEL_ERROR",
      correlation_id: context.request_id,
      error_class: error instanceof Error ? error.name : "unknown"
    });
    decision = buildDeterministicSafetyDecision(context, "provider_unavailable");
    mutationSource = "provider_unavailable";
  }

  if (decision) {
    const validation = validateConversationDecision(decision, context);
    validationReasons = validation.reason_codes;
    const quality = validateSemanticQuality(decision.reply.text, context);
    qualityReasons = quality.reason_codes;
    if (!validation.ok || !quality.ok) {
      const repairReasons = [...new Set([...validation.reason_codes, ...quality.reason_codes])];
      if (modelCallCount > 0) {
        try {
          modelCallCount += 1;
          const repairResult = await runModelDecision({
            modelExecutionService: input.modelExecutionService,
            backendContext: input.backendContext,
            context,
            env: input.env,
            repairInput: {
              previousRawText: rawModelOutput,
              reasonCodes: repairReasons
            }
          });
          if (repairResult.decision) {
            const repairValidation = validateConversationDecision(repairResult.decision, context);
            const repairQuality = validateSemanticQuality(repairResult.decision.reply.text, context);
            validationReasons = [...repairReasons, ...repairValidation.reason_codes];
            qualityReasons = [...quality.reason_codes, ...repairQuality.reason_codes];
            if (repairValidation.ok && repairQuality.ok) {
              decision = repairResult.decision;
              replyMutatedAfterModel = true;
              mutationSource = "model_repair";
            } else {
              decision = buildDeterministicSafetyDecision(context, "invalid_model_decision");
              replyMutatedAfterModel = true;
              mutationSource = "deterministic_safety_response";
            }
          } else {
            decision = buildDeterministicSafetyDecision(context, "invalid_model_decision");
            replyMutatedAfterModel = true;
            mutationSource = "deterministic_safety_response";
          }
        } catch (error) {
          input.logger.warn({
            event_type: "CONVERSATION_DECISION_V2_REPAIR_MODEL_ERROR",
            correlation_id: context.request_id,
            error_class: error instanceof Error ? error.name : "unknown"
          });
          decision = buildDeterministicSafetyDecision(context, "provider_unavailable");
          replyMutatedAfterModel = true;
          mutationSource = "deterministic_transport_failure";
        }
      } else {
        decision = buildDeterministicSafetyDecision(context, "invalid_model_decision");
        mutationSource = "deterministic_safety_response";
      }
    }
  } else {
    decision = buildDeterministicSafetyDecision(
      context,
      context.canonical_policy_facts.length === 0 ? "policy_missing" : "invalid_model_decision"
    );
    mutationSource = "deterministic_safety_response";
  }

  const statePatch = validateAndApplyStatePatch(
    input.backendContext.state,
    decision,
    context,
    input.env.approvedApps
  );

  const finalQuality = validateSemanticQuality(decision.reply.text, context);
  const finalValidation = validateConversationDecision(decision, context);
  if (!finalQuality.ok || !finalValidation.ok) {
    decision = buildDeterministicSafetyDecision(context, "invalid_model_decision");
    replyMutatedAfterModel = true;
    mutationSource = "final_validation_safety_response";
  }
  const finalReply = decision.reply.text;

  recordDecisionTrace({
    logger: input.logger,
    context,
    decision,
    validationReasons: [...validationReasons, ...finalValidation.reason_codes],
    qualityReasons: [...qualityReasons, ...finalQuality.reason_codes],
    statePatchReasons: statePatch.reason_codes,
    finalReplyOrigin: decision.origin ?? "conversation_decision_v2_model",
    modelCallCount,
    replyMutatedAfterModel,
    mutationSource,
    behaviorPromptVersion: CONVERSATION_BEHAVIOR_PROMPT_VERSION
  });

  return {
    context,
    decision,
    finalReply,
    nextState: statePatch.state,
    validation_reason_codes: [...new Set([...validationReasons, ...finalValidation.reason_codes])],
    quality_reason_codes: [...new Set([...qualityReasons, ...finalQuality.reason_codes])],
    state_patch_reason_codes: statePatch.reason_codes,
    origin: decision.origin ?? "conversation_decision_v2_model",
    model_call_count: modelCallCount,
    reply_mutated_after_model: replyMutatedAfterModel,
    mutation_source: mutationSource,
    behavior_prompt_version: CONVERSATION_BEHAVIOR_PROMPT_VERSION
  };
}
