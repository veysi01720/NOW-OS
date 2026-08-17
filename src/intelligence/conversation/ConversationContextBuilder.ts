import type { EnvConfig } from "../../config/env.js";
import type { BackendContextPayloadV1 } from "../../contracts/backendContextPayload.js";
import type { NormalizedIncomingMessage } from "../../bridge/normalizeEvolutionMessage.js";
import { resolveAllowedActions } from "./AllowedActionResolver.js";
import { resolveCandidatePolicy } from "../candidate/CandidatePolicyResolver.js";
import type { ConversationDecisionContext } from "./ConversationDecisionSchema.js";

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/\u0131/gu, "i")
    .replace(/\u0130/gu, "i");
}

export function inferConversationIntent(text: string): string | null {
  const normalized = normalize(text);

  if (/(reklam.*bilgi|daha fazla bilgi)/u.test(normalized)) {
    return "ask_how_work_is_done";
  }
  if (/(^|\b)(is)\s*(nedir|ne|tam olarak ne)|ne yapacagim|ne yapacam|tam olarak ne yapmam gerekiyor|nasil para kazaniliyor|is nasil yapiliyor|anlamadim.*is\s*ne/u.test(normalized)) {
    return "ask_job_definition";
  }
  if (/^(selam|merhaba|mrb|slm)\b/u.test(normalized)) {
    if (/(is|calisma|basvuru)/u.test(normalized)) {
      return "candidate_first_contact";
    }
    return "greeting_or_first_contact";
  }
  if (/^(is)\s*(var mi|icin|basvuru)|\bis\s*icin\s*yazdim\b/u.test(normalized)) {
    return "candidate_first_contact";
  }
  if (/(anlamadim|daha acik anlat|nasil yani|ne demek|biraz acar misin|tam olarak nasil|calisma modeli nedir|calisma modelini anlamadim)/u.test(normalized)) {
    return "clarify_previous_explanation";
  }
  if (/(nasil yapacagim|bu isi nasil|kamera acacak miyim|mesajlasma nasil|erkek hesabi)/u.test(normalized)) {
    if (normalized.includes("erkek hes") || normalized.includes("erkek prof")) return "account_profile_question";
    return "ask_how_work_is_done";
  }
  if (/(indir|indirme|link|url|download|nereden yukle)/u.test(normalized)
    && /(layla|nivi|tanchat|tanstar|linky|soyo|timo|amar|uygulama|app|platform)/u.test(normalized)) {
    return "app_fact_question";
  }
  if (/(hangi uygulamalar|uygulamalar var|hangi app|hangi platform|hangi uygulama|uygulama oner)/u.test(normalized)) {
    return "app_selection_question";
  }
  if (/(kurulum|kuruluma|kuracagim|kurmam|devam edebilir|davet kodu|ajans kodu|ekran onay|onay)/u.test(normalized)) {
    return "installation_question";
  }

  const asksGeneralQuestion = /(^|\s|\?)(kim|ne|nerede|neden|nasil|hangi|bugun|hava)(\s|\?|$)/u.test(normalized) || normalized.includes("?");
  const hasWorkContext = /(is|calisma|basvuru|uygulama|kurulum|kazanc|kazan|odeme|puan|profil|hesap|kamera|mesaj|egitim|ilerle|yardim|destek|surec|adim|bilgi|uygun|onay|link|indir|download|layla|nivi|tanchat|tanstar|linky|soyo|timo|amar|reklam)/u.test(normalized);
  if (asksGeneralQuestion && !hasWorkContext) return "off_topic";
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
  const inferredIntent = inferConversationIntent(input.message.text);
  const policy = resolveCandidatePolicy(
    state,
    input.env.approvedApps,
    input.backendContext.structured_facts?.app_facts ?? [],
    input.backendContext.structured_facts?.general_work_model ?? null,
    inferredIntent,
    input.backendContext.structured_facts?.policy_sections ?? null,
    input.backendContext.structured_facts?.owner_transfer_sections ?? [],
  );
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
      dialogue_phase: state.current_state,
      policy_stage: policy.stage,
      policy_section_ids: policy.policy_section_ids,
      policy_context_token_estimate: policy.policy_context_token_estimate,
      missing_stage_sections: policy.missing_stage_sections,
    },
    facts_extracted_from_current_message: [...input.capturedFields],
    canonical_policy_facts: policy.facts,
    structured_facts: input.backendContext.structured_facts ?? {
      app_facts_source_status: "missing",
      app_facts_source_hash: null,
      app_facts: [],
      general_work_model: null,
      policy_sections: null,
      owner_transfer_sections: [],
      errors: ["app_facts_structured.json missing from backend context"],
    },
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
