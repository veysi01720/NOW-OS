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

function asksConcreteOperationalFact(normalized: string): boolean {
  return /(link|url|download|indir|yukle|davet|invite|ajans|agency|kod|code|kurulum|kuruluma|kuracagim|sure|ne kadar|odeme ne zaman|puan|iban|minimum|kesinti|hangi uygulama|uygulamalar var|kamera|profil|hesap|android|iphone|ios|layla|nivi|tanchat|tanstar|linky|soyo|timo|amar)/u.test(normalized);
}

function looksLikeRhetoricalBanter(normalized: string): boolean {
  if (asksConcreteOperationalFact(normalized)) return false;

  const questionLike =
    normalized.includes("?")
    || /\b(mi|mu|miyim|miyiz|misin|musun|miydin|miydik|miyiz)\b/u.test(normalized);
  if (!questionLike) return false;

  const selfOrBotDirected = /\b(sen|siz|bot|beni|bana|bizi|hepimizi|burayi|bu is|burada|hayatim)\b/u.test(normalized);
  const exaggeratedOrSocialOutcome =
    /(zengin|koseyi\s+don|kral|patron|ucur|hayat.{0,20}degis|sevec|sevecek|seviyor|asik|evlen|mutlu\s+ed|adam\s+eder|kurtar)/u.test(normalized);
  const philosophicalOrVibe =
    /(hayal|ruya|saka|dalga|ciddi\s+misin|bize\s+yarar\s+mi|olur\s+mu\s+boyle)/u.test(normalized);

  return (selfOrBotDirected && exaggeratedOrSocialOutcome) || philosophicalOrVibe;
}

export function inferConversationIntent(text: string): string | null {
  const normalized = normalize(text);

  if (looksLikeRhetoricalBanter(normalized)) {
    return "rhetorical_or_banter";
  }
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

function buildKnownCandidateFacts(state: BackendContextPayloadV1["state"]): NonNullable<ConversationDecisionContext["known_candidate_facts"]> {
  const confirmedFields: NonNullable<ConversationDecisionContext["known_candidate_facts"]>["confirmed_fields"] = [];
  if (state.age !== null) confirmedFields.push({ field: "age", value: state.age, source: "candidate_state" });
  if (state.gender !== null) confirmedFields.push({ field: "gender", value: state.gender, source: "candidate_state" });
  if (state.daily_hours !== null) confirmedFields.push({ field: "daily_hours", value: state.daily_hours, source: "candidate_state" });
  if (state.model_acceptance !== null && state.model_acceptance !== undefined) {
    confirmedFields.push({ field: "work_model_acceptance", value: state.model_acceptance, source: "candidate_state" });
  }
  if (state.selected_app !== null) confirmedFields.push({ field: "selected_app", value: state.selected_app, source: "candidate_state" });
  if (state.phone_type !== null) confirmedFields.push({ field: "phone_type", value: state.phone_type, source: "candidate_state" });

  const missingFields = [...state.missing_fields];
  const doNotAskFields = confirmedFields.map((item) => item.field);
  const summary = confirmedFields.length === 0
    ? `Confirmed candidate facts: none. Missing fields: ${missingFields.join(", ") || "none"}.`
    : `Confirmed candidate facts: ${confirmedFields.map((item) => `${item.field}=${item.value}`).join(", ")}. Missing fields: ${missingFields.join(", ") || "none"}. Do not ask again: ${doNotAskFields.join(", ")}.`;

  return {
    confirmed_fields: confirmedFields,
    missing_fields: missingFields,
    do_not_ask_fields: doNotAskFields,
    summary,
  };
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
    known_candidate_facts: buildKnownCandidateFacts(state),
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
