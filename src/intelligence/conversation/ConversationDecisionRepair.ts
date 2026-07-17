import type { ConversationDecision, ConversationDecisionAction, ConversationDecisionContext } from "./ConversationDecisionSchema.js";

function normalize(value: string): string {
  return value.toLocaleLowerCase("tr-TR").normalize("NFKD").replace(/\p{M}/gu, "").replace(/ı/gu, "i");
}

function hasWorkQuestion(text: string): boolean {
  const normalized = normalize(text);
  return /(nasil|ne yapacagim|hesap|is|calisma|kamera|mesajlasma|anlamadim)/u.test(normalized);
}

function baseDecision(reply: string, context: ConversationDecisionContext, origin: ConversationDecision["origin"]): ConversationDecision {
  const direct = hasWorkQuestion(context.latest_message.text);
  return {
    decision_version: "2.0",
    intent: {
      primary: context.latest_message.inferred_intent ?? (direct ? "ask_how_work_is_done" : "candidate_next_step"),
      secondary: [],
      confidence: 1
    },
    direct_question: {
      present: direct,
      question_summary: direct ? "Aday son mesajında açıklama veya netleştirme istiyor" : null,
      answered_in_reply: true
    },
    reply: {
      text: reply,
      language: "tr",
      tone: "natural_concise",
      contains_question: /\?/.test(reply)
    },
    chosen_actions: direct ? ["answer_user_question"] : ["clarify_ambiguous_input"],
    state_patch: {},
    policy_facts_used: [],
    next_action: "none",
    requires_escalation: origin !== "conversation_decision_v2_model",
    escalation_reason: origin === "deterministic_transport_failure" ? "model_transport_failure" : "conversation_decision_invalid",
    risk_flags: [],
    self_check: {
      answered_latest_message: true,
      asked_known_information_again: false,
      invented_policy: false,
      offered_setup_too_early: false,
      used_generic_closing: false
    },
    origin
  };
}

function approvedAppFromFacts(context: ConversationDecisionContext): string | null {
  const policyText = normalize(context.canonical_policy_facts.map((fact) => `${fact.fact} ${fact.content}`).join("\n"));
  return ["Layla", "Soyo", "Amar", "Timo", "Linky"].find((app) => policyText.includes(normalize(app))) ?? null;
}

function missingFieldActions(context: ConversationDecisionContext): ConversationDecisionAction[] {
  const actions: ConversationDecisionAction[] = ["answer_user_question", "explain_work_model"];
  if (context.candidate_state.age === null) actions.push("ask_missing_age");
  if (context.candidate_state.gender === null) actions.push("ask_missing_gender");
  if (context.candidate_state.daily_hours === null) actions.push("ask_missing_daily_hours");
  if (actions.length === 2 && context.candidate_state.work_model_acceptance !== "accepted") {
    actions.push("request_work_model_acceptance");
  }
  return actions.filter((action, index, array) => array.indexOf(action) === index);
}

function nextActionFor(context: ConversationDecisionContext): ConversationDecision["next_action"] {
  if (context.candidate_state.age === null) return "ask_missing_age";
  if (context.candidate_state.gender === null) return "ask_missing_gender";
  if (context.candidate_state.daily_hours === null) return "ask_missing_daily_hours";
  if (context.candidate_state.work_model_acceptance !== "accepted") return "request_work_model_acceptance";
  return "none";
}

function buildJobDefinitionSafetyDecision(context: ConversationDecisionContext): ConversationDecision {
  const app = approvedAppFromFacts(context);
  const latest = normalize(context.latest_message.text);
  const asksEarnings = /(kazanc|kazanç|para|odeme|ödeme|puan)/u.test(latest);
  const missing: string[] = [];
  if (context.candidate_state.age === null) missing.push("yaş");
  if (context.candidate_state.gender === null) missing.push("cinsiyet");
  if (context.candidate_state.daily_hours === null) missing.push("günlük ayırabileceğin süre");

  const appPart = app ? `${app} içinde ` : "Onaylı uygulama içinde ";
  const nextPart = missing.length > 0
    ? `Devam edebilmem için ${missing.join(", ")} bilgisini netleştirelim.`
    : "Bu çalışma modeli sana uygunsa kuruluma geçmeden önce bunu netleştirelim.";
  const earningsPart = asksEarnings
    ? "Kazanç veya ödeme detayı için doğrulanmış bilgi yoksa bunu uydurmadan ekip netleştirir. "
    : "";
  const reply =
    `İşin temel kısmı, ${appPart}gelen sohbet veya mesajlara yazıyla düzgün cevap vermek. ` +
    "Kamera/görüntülü çalışma zorunlu diye bir kural söylemiyoruz; mesajlaşma ağırlıklı ilerleyebilirsin. " +
    earningsPart +
    nextPart;

  return {
    ...baseDecision(reply, context, "deterministic_safety_response"),
    intent: { primary: "ask_job_definition", secondary: [], confidence: 1 },
    direct_question: {
      present: true,
      question_summary: "Aday işin ne olduğunu soruyor",
      answered_in_reply: true
    },
    chosen_actions: missingFieldActions(context),
    policy_facts_used: context.canonical_policy_facts.map((fact) => fact.id),
    next_action: nextActionFor(context),
    requires_escalation: false,
    escalation_reason: null
  };
}

export function buildDeterministicSafetyDecision(
  context: ConversationDecisionContext,
  reason: "invalid_model_decision" | "provider_unavailable" | "policy_missing"
): ConversationDecision {
  if (reason === "invalid_model_decision" && context.latest_message.inferred_intent === "ask_job_definition") {
    return buildJobDefinitionSafetyDecision(context);
  }

  const reply = reason === "provider_unavailable"
    ? "Şu an yanıtı güvenli şekilde oluşturamadım. Yanlış yönlendirmemek için ekip bu mesajı netleştirsin."
    : reason === "policy_missing"
      ? "Bu konuda doğrulanmış bilgi eksik. Yanlış yönlendirmemek için ekip netleştirsin."
      : "Bu cevabı güvenli şekilde netleştiremedim. Yanlış yönlendirmemek için ekip kontrol etsin.";
  return baseDecision(
    reply,
    context,
    reason === "provider_unavailable" ? "deterministic_transport_failure" : "deterministic_safety_response"
  );
}
