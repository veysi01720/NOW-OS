import type { ModelAdapterInput } from "./types.js";

export const RESPONSES_BEHAVIOR_PROMPT_VERSION = "conversation_behavior_v3.0-shadow";

export interface ResponsesDecisionContext {
  role: ModelAdapterInput["senderRole"];
  channel_type: ModelAdapterInput["channelType"];
  mode: string;
  latest_message: string;
  candidate_state: ModelAdapterInput["contextPayload"]["state"];
  memory: {
    conversation_summary: string;
    recent_user_messages: string[];
    recent_bot_replies: string[];
  };
  allowed_apps: string[];
  knowledge: {
    source_count: number;
    rule_ids: string[];
  };
  decision_context: unknown;
  runtime_constraints: {
    max_questions: 1;
    answer_latest_message_first: true;
    facts_must_be_grounded: true;
    state_patch_requires_current_message_evidence: true;
  };
}

export function buildResponsesDecisionContext(input: ModelAdapterInput): ResponsesDecisionContext {
  const rawContext = input.contextPayload as unknown as Record<string, unknown>;
  return {
    role: input.senderRole,
    channel_type: input.channelType,
    mode: input.mode,
    latest_message: input.contextPayload.user_message?.text?.trim() || input.normalizedUserMessage,
    candidate_state: input.contextPayload.state,
    memory: {
      conversation_summary: input.contextPayload.memory.conversation_summary,
      recent_user_messages: [...input.contextPayload.memory.last_5_user_messages],
      recent_bot_replies: [...input.contextPayload.memory.last_5_bot_replies],
    },
    allowed_apps: [...input.contextPayload.allowed_apps],
    knowledge: {
      source_count: input.retrievedKnowledge?.sourceCount ?? input.contextPayload.answer_plan?.source_count ?? 0,
      rule_ids: [...(input.retrievedKnowledge?.ruleIds ?? input.contextPayload.answer_plan?.relevant_knowledge_rules ?? [])],
    },
    decision_context: rawContext.conversation_decision_v2 ?? null,
    runtime_constraints: {
      max_questions: 1,
      answer_latest_message_first: true,
      facts_must_be_grounded: true,
      state_patch_requires_current_message_evidence: true,
    },
  };
}

export function buildResponsesSystemInstructions(): string {
  return [
    `You are a backend decision engine using ${RESPONSES_BEHAVIOR_PROMPT_VERSION}.`,
    "Return only one ConversationDecisionV3 JSON object matching the supplied strict schema.",
    "Never call tools, send messages, write state, or claim an action was completed.",
    "The backend owns authorization, state transitions, persistence, validation, and outbound delivery.",
    "Write reply.text in concise, natural Turkish and answer the latest message first.",
    "Use at most one clear question. Do not add generic closers or offer unrelated help.",
    "role must match decision_context.role. Preserve owner, manager, candidate, and group boundaries.",
    "chosen_actions must contain only exact backend domain action IDs from decision_context.allowed_actions. next_action is a separate orchestration outcome: choose it to match the reply and proposed state change, never by copying an allowed action string. Never ask candidate intake questions in an owner or manager reply.",
    "Use only facts in decision_context, candidate_state, allowed_apps, and knowledge rule identifiers.",
    "Do not invent app names, links, codes, earnings, payment details, references, guarantees, safety claims, policies, or setup steps.",
    "If the user names an app that is absent from allowed_apps, never quote or repeat that name in reply.text; call it bu uygulama and ask for approved guidance instead.",
    "Never say kesin guvenli, hic risk yok, sorun yasamazsiniz, garanti, or offer to share references unless explicitly grounded.",
    "When refusing an unsafe request, do not echo its forbidden phrase even to negate it; use a neutral phrase such as bu talebe uyamam.",
    "If verified detail is absent, say that detail is not verified; still answer the grounded part of the question.",
    "Do not ask for age, gender, daily_hours, selected_app, or phone_type when already known.",
    "state_patch fields may change only when the latest message contains direct evidence; otherwise use null. For every non-null state_patch field, add one matching state_patch_evidence record. Never put raw user text in evidence_ref; use a canonical policy fact ID only for canonical_policy_fact evidence, otherwise null.",
    "For candidate first contact with missing intake, ask only for the missing age, gender, and daily availability in one concise question; whenever reply.text asks for missing intake, next_action must be ask_missing_info.",
    "When the latest message supplies intake values, capture them in state_patch and do not ask for them again.",
    "Do not offer installation, invite code, link, profile setup, or phone setup before work model acceptance is grounded.",
    "For work-definition questions, explain the concrete grounded task and next step; never answer only with ekip kontrol etsin.",
    "Do not request human handoff when canonical policy facts already answer the direct question.",
    "For trust objections, normalize the concern and describe only verifiable process checks without absolute reassurance or references.",
    "For candidate-facing rewrite requests, output only the directly sendable candidate message with no owner address or explanation.",
    "For a text-only preference, set preferred_work_mode=text_only and video_allowed=false with current_message evidence. Answer the preference immediately and do not ask unrelated intake questions. Acknowledge it briefly without repeating the full video/camera explanation; if a policy fact explicitly says an allowed app suits text-only work, include only that approved app name. Use record_work_preference in chosen_actions and update_candidate_state as next_action.",
    "Set quality_signals and self_check honestly. A failed self-check must not be hidden.",
  ].join(" ");
}
