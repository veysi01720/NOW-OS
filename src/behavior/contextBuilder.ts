import type { BackendContextPayloadV1 } from "../contracts/backendContextPayload.js";
import { getDefaultBehaviorProfile } from "./behaviorProfile.js";
import { sanitizeSummary } from "./conversationStateService.js";
import { planResponse } from "./responsePlanner.js";
import type {
  BehaviorProfile,
  ConversationState,
  ResponsePlannerInput,
  UserIntent,
  UserStage,
} from "./types.js";

type BehaviorContext = NonNullable<BackendContextPayloadV1["behavior_context"]>;

const MAX_RECENT_MESSAGES = 8;
const MAX_MESSAGE_PREVIEW_CHARS = 240;
const MAX_SUMMARY_CHARS = 600;
const MAX_RULE_IDS = 8;
const OUTPUT_CONTRACT_REMINDER =
  'Return only Assistant Response Contract v1.0 JSON with contract_version "1.0", reply, and internal_boss_note. WhatsApp receives only reply.';

function truncate(value: string | undefined | null, max: number): string {
  if (!value) return "";
  const trimmed = sanitizeSummary(value).trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 3).trimEnd()}...`;
}

function inferUserStage(context: BackendContextPayloadV1): UserStage {
  if (context.sender_role === "owner" || context.sender_role === "manager") return "active";
  if (context.chat_type === "group") return "unknown";
  if (context.state.current_state === "READY_FOR_INSTALLATION") return "ready";
  if (context.state.current_state === "WAITING_FOR_APP" || context.state.current_state === "WAITING_FOR_PHONE_TYPE") {
    return "interested";
  }
  if (context.memory.last_10_messages.length > 0) return "exploring";
  return "new";
}

function inferIntent(context: BackendContextPayloadV1): UserIntent | null {
  const intent = context.answer_plan?.intent ?? context.memory.last_intent ?? null;
  if (!intent) return null;
  if (intent.includes("trust") || intent.includes("payment")) return "hesitation";
  if (intent.includes("support")) return "support_request";
  if (intent.includes("complaint")) return "complaint";
  if (intent.includes("ready")) return "ready_to_start";
  if (intent === "casual") return "casual_message";
  if (intent === "unknown") return "unknown";
  return "question";
}

function buildConversationState(context: BackendContextPayloadV1): ConversationState {
  const stage = inferUserStage(context);
  const intent = inferIntent(context);
  return {
    tenantId: "now_os",
    conversationId: context.correlation_id,
    channelType: context.chat_type,
    currentMode: context.answer_plan?.mode ?? (context.chat_type === "group" ? "group_mode" : "conversation_mode"),
    userStage: stage,
    lastResolvedIntent: intent,
    unresolvedObjections: [],
    completedTopics: context.state.missing_fields.length === 0 ? ["candidate_required_fields"] : [],
    pendingTopics: [...context.state.missing_fields],
    lastAssistantAction: "none",
    lastUserSentiment: "neutral",
    escalationStatus: context.answer_plan?.escalation_required ? "required" : "none",
    summary: truncate(context.memory.summary ?? context.memory.conversation_summary, MAX_SUMMARY_CHARS),
    textOnlyPreference: false,
    preferredWorkMode: "video_or_voice_allowed",
    videoAllowed: true,
    updatedAt: new Date().toISOString(),
  };
}

function latestUserText(context: BackendContextPayloadV1): string {
  return context.memory.last_5_user_messages.at(-1) ?? context.memory.last_10_messages.at(-1) ?? "";
}

function recentMessages(context: BackendContextPayloadV1): BehaviorContext["recent_messages"] {
  const seen = new Set<string>();
  const output: BehaviorContext["recent_messages"] = [];
  const botReplies = new Set(context.memory.last_5_bot_replies.map((message) => message.trim()));

  for (const rawMessage of context.memory.last_10_messages.slice().reverse()) {
    const preview = truncate(rawMessage, MAX_MESSAGE_PREVIEW_CHARS);
    const key = preview.toLocaleLowerCase("tr-TR");
    if (!preview || seen.has(key)) continue;
    seen.add(key);
    output.unshift({
      role: botReplies.has(rawMessage.trim()) ? "assistant" : "user",
      preview,
    });
    if (output.length >= MAX_RECENT_MESSAGES) break;
  }

  return output;
}

function profileToContext(profile: BehaviorProfile): BehaviorContext["behavior_profile"] {
  return {
    tone: profile.tone,
    max_reply_length: profile.maxReplyLength,
    ask_one_question_at_a_time: profile.askOneQuestionAtATime,
    avoid_repeating_known_information: profile.avoidRepeatingKnownInformation,
    use_conversation_history: profile.useConversationHistory,
    allow_follow_up_question: profile.allowFollowUpQuestion,
    allow_persuasion: profile.allowPersuasion,
    prohibited_behaviors: [...profile.prohibitedBehaviors],
  };
}

function plannerInput(context: BackendContextPayloadV1, state: ConversationState): ResponsePlannerInput {
  const authorized = context.sender_role === "owner" || context.sender_role === "manager";
  return {
    channelType: context.chat_type,
    mode: state.currentMode,
    senderRole: context.sender_role,
    normalizedText: latestUserText(context),
    currentUserStage: state.userStage,
    lastResolvedIntent: state.lastResolvedIntent,
    unresolvedObjections: state.unresolvedObjections,
    completedTopics: state.completedTopics,
    pendingTopics: state.pendingTopics,
    isGroup: context.chat_type === "group",
    isAuthorized: authorized,
    answerPlan: context.answer_plan
      ? {
          mode: context.answer_plan.mode,
          intent: context.answer_plan.intent,
          escalation_required: context.answer_plan.escalation_required,
          source_count: context.answer_plan.source_count,
        }
      : undefined,
  };
}

export function buildBehaviorOrchestratedContext(
  legacyContext: BackendContextPayloadV1,
  loadedConversationState?: ConversationState,
): BackendContextPayloadV1 {
  const context = JSON.parse(JSON.stringify(legacyContext)) as BackendContextPayloadV1;
  const profile = getDefaultBehaviorProfile();
  const state = loadedConversationState ?? buildConversationState(context);
  const responsePlan = planResponse(plannerInput(context, state));

  context.behavior_context = {
    base_behavior:
      "Use backend_context as source of truth, keep replies short and natural, answer only with approved knowledge, and never expose internal metadata.",
    behavior_profile: profileToContext(profile),
    response_plan: {
      objective: responsePlan.objective,
      desired_length: responsePlan.desiredLength,
      may_ask_question: responsePlan.mayAskQuestion,
      should_use_knowledge: responsePlan.shouldUseKnowledge,
      should_acknowledge_emotion: responsePlan.shouldAcknowledgeEmotion,
      should_avoid_repetition: responsePlan.shouldAvoidRepetition,
      forbidden_topics: [...responsePlan.forbiddenTopics],
      requires_model_call: responsePlan.requiresModelCall,
    },
    quality_contract: {
      contract_version: responsePlan.quality.contractVersion,
      primary_intent: responsePlan.quality.primaryIntent,
      conversation_stage: responsePlan.quality.conversationStage,
      response_goal: responsePlan.quality.responseGoal,
      answer_scope: responsePlan.quality.answerScope,
      tone: responsePlan.quality.tone,
      length_budget: responsePlan.quality.lengthBudget,
      must_include: [...responsePlan.quality.mustInclude],
      must_avoid: [...responsePlan.quality.mustAvoid],
      ask_followup: responsePlan.quality.askFollowup,
      followup_purpose: responsePlan.quality.followupPurpose,
      use_conversation_history: responsePlan.quality.useConversationHistory,
      avoid_repetition: responsePlan.quality.avoidRepetition,
      escalation_required: responsePlan.quality.escalationRequired,
      escalation_reason: responsePlan.quality.escalationReason,
      confidence: responsePlan.quality.confidence,
    },
    continuity_signals: {
      facts_already_given: responsePlan.quality.continuitySignals.factsAlreadyGiven.map((item) => sanitizeSummary(item)),
      steps_already_completed: responsePlan.quality.continuitySignals.stepsAlreadyCompleted.map((item) => sanitizeSummary(item)),
      user_preferences_known: responsePlan.quality.continuitySignals.userPreferencesKnown.map((item) => sanitizeSummary(item)),
      repeated_intent: responsePlan.quality.continuitySignals.repeatedIntent,
      last_assistant_goal: responsePlan.quality.continuitySignals.lastAssistantGoal,
    },
    conversation_state_snapshot: {
      current_mode: state.currentMode,
      user_stage: state.userStage,
      current_state: context.state.current_state,
      selected_app: context.state.selected_app,
      phone_type: context.state.phone_type,
      missing_fields: [...context.state.missing_fields],
      expected_next_step: context.state.expected_next_step,
      unresolved_objections: state.unresolvedObjections.slice(0, 5).map((item) => sanitizeSummary(item)),
      completed_topics: state.completedTopics.slice(0, 8).map((item) => sanitizeSummary(item)),
      pending_topics: state.pendingTopics.slice(0, 8).map((item) => sanitizeSummary(item)),
      last_user_sentiment: state.lastUserSentiment,
      escalation_status: state.escalationStatus,
      preferred_work_mode: state.preferredWorkMode ?? (state.textOnlyPreference ? "text_only" : "video_or_voice_allowed"),
      video_allowed: state.videoAllowed ?? !state.textOnlyPreference,
      summary: sanitizeSummary(state.summary),
    },
    recent_messages: recentMessages(context),
    retrieved_knowledge_summary: context.answer_plan
      ? {
          source_count: context.answer_plan.source_count,
          rule_ids: context.answer_plan.relevant_knowledge_rules.slice(0, MAX_RULE_IDS),
          relevant_app_present: context.answer_plan.relevant_app_fact !== null,
          relevant_link_present: context.answer_plan.relevant_link_item !== null,
        }
      : undefined,
    prohibited_behaviors: [...profile.prohibitedBehaviors, ...responsePlan.forbiddenTopics],
    output_contract_reminder: OUTPUT_CONTRACT_REMINDER,
    metadata: {
      mode: state.currentMode,
      channel_type: context.chat_type,
      sender_role: context.sender_role,
      trace_id: context.correlation_id,
    },
  };

  return context;
}
