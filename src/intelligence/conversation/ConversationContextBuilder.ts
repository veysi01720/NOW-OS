import type { EnvConfig } from "../../config/env.js";
import type { BackendContextPayloadV1 } from "../../contracts/backendContextPayload.js";
import type { NormalizedIncomingMessage } from "../../bridge/normalizeEvolutionMessage.js";
import { resolveAllowedActions } from "./AllowedActionResolver.js";
import { resolveCandidatePolicy } from "../candidate/CandidatePolicyResolver.js";
import type { ConversationDecisionContext } from "./ConversationDecisionSchema.js";

function normalize(value: string): string {
  return value.toLocaleLowerCase("tr-TR").normalize("NFKD").replace(/\p{M}/gu, "").replace(/ı/gu, "i");
}

export function inferConversationIntent(text: string): string | null {
  const normalized = normalize(text);
  if (/(^|\b)(is|iş)\s*(nedir|ne|tam olarak ne)|ne yapacagim|ne yapacağim|ne yapacam|ne yapacağım|tam olarak ne yapmam gerekiyor|nasil para kazaniliyor|nasıl para kazanılıyor|is nasil yapiliyor|iş nasıl yapılıyor|anlamadim.*(is|iş)\s*ne/u.test(normalized)) {
    return "ask_job_definition";
  }
  if (/^(selam|merhaba|mrb|slm)\b/u.test(normalized)) {
    if (/(is|iş|calisma|çalisma|çalışma|basvuru|başvuru)/u.test(normalized)) {
      return "candidate_first_contact";
    }
    return "greeting_or_first_contact";
  }
  if (/^(is|iş)\s*(var mi|var mı|icin|için|basvuru|başvuru)|\b(is|iş)\s*icin\s*yazdim\b/u.test(normalized)) {
    return "candidate_first_contact";
  }
  if (/(anlamadim|daha acik anlat|nasil yani|ne demek|biraz acar misin|tam olarak nasil|calisma modeli nedir|calisma modelini anlamadim)/u.test(normalized)) {
    return "clarify_previous_explanation";
  }
  if (/(nasil yapacagim|nasil yapacağim|bu isi nasil|bu işi nasil|kamera acacak miyim|mesajlasma nasil|erkek hesabi|erkek hesabı)/u.test(normalized)) {
    return "ask_how_work_is_done";
  }
  return null;
}

export function buildConversationDecisionContext(input: {
  message: NormalizedIncomingMessage;
  backendContext: BackendContextPayloadV1;
  env: EnvConfig;
  capturedFields: string[];
}): ConversationDecisionContext {
  const state = input.backendContext.state;
  const intakeComplete = state.age !== null && state.gender !== null && state.daily_hours !== null;
  const allowedActions = resolveAllowedActions(state);
  const policy = resolveCandidatePolicy(state, input.env.approvedApps);
  const recent: Array<{ role: "user" | "assistant"; text: string }> = [];
  const max = Math.max(
    input.backendContext.memory.last_5_user_messages.length,
    input.backendContext.memory.last_5_bot_replies.length
  );
  for (let index = 0; index < max; index += 1) {
    const userText = input.backendContext.memory.last_5_user_messages[index];
    const assistantText = input.backendContext.memory.last_5_bot_replies[index];
    if (userText) recent.push({ role: "user", text: userText });
    if (assistantText) recent.push({ role: "assistant", text: assistantText });
  }
  const inferredIntent = inferConversationIntent(input.message.text);

  return {
    request_id: input.message.correlation_id,
    decision_version: "conversation_v2",
    tenant_id: "now_os",
    instance_id: input.env.evolutionInstance,
    channel: input.backendContext.chat_type,
    role: input.backendContext.sender_role,
    latest_message: {
      id: input.message.message_id,
      text: input.message.text,
      timestamp: input.message.received_at,
      language: "tr",
      inferred_intent: inferredIntent
    },
    recent_messages: recent,
    candidate_state: {
      age: state.age,
      gender: state.gender,
      daily_hours: state.daily_hours,
      work_model_acceptance: state.model_acceptance ?? null,
      selected_app: state.selected_app,
      phone_type: state.phone_type
    },
    derived_state: {
      intake_complete: intakeComplete,
      eligibility_status: policy.policyMissing ? "policy_missing" : state.eligibility_status ?? "unresolved",
      dialogue_phase: state.current_state
    },
    facts_extracted_from_current_message: [...input.capturedFields],
    canonical_policy_facts: policy.facts,
    allowed_actions: allowedActions.allowed,
    forbidden_actions: allowedActions.forbidden,
    runtime_constraints: {
      max_reply_length: 800,
      max_questions: 1,
      must_answer_direct_question_first: true,
      facts_must_be_grounded: true,
      behavior_prompt_version: "conversation_behavior_v2.1"
    }
  };
}
