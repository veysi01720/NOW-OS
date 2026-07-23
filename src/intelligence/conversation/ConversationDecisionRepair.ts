import type { ConversationDecision, ConversationDecisionAction, ConversationDecisionContext } from "./ConversationDecisionSchema.js";

function normalize(value: string): string {
  return value.toLocaleLowerCase("tr-TR").normalize("NFKD").replace(/\p{M}/gu, "").replace(/ı/gu, "i");
}

const FALLBACK_REPEAT_MIN_CHARS = 40;
const FALLBACK_REPEAT_OVERLAP = 0.95;

function tokens(value: string): string[] {
  return normalize(value)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function tokenOverlap(a: string, b: string): number {
  const left = new Set(tokens(a));
  const right = new Set(tokens(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  return shared / Math.min(left.size, right.size);
}

function fallbackTopic(context: ConversationDecisionContext): string {
  const intent = context.latest_message.inferred_intent;
  const latest = normalize(context.latest_message.text);
  if (intent === "ask_job_definition" || intent === "ask_how_work_is_done") return "işin nasıl ilerlediği";
  if (/(uygulama|app|platform)/u.test(latest)) return "uygulama bilgisi";
  if (/(kazanc|kazan.|para|odeme|puan)/u.test(latest)) return "kazanç veya ödeme";
  if (/(kamera|hesap|profil|video|goruntulu)/u.test(latest)) return "kamera, hesap veya profil";
  if (intent === "clarify_previous_explanation") return "önceki açıklama";
  return "bu konu";
}

function repeatsRecentAssistantReply(reply: string, context: ConversationDecisionContext): boolean {
  return context.recent_messages
    .filter((message) => message.role === "assistant")
    .some((message) => {
      const previous = normalize(message.text);
      const current = normalize(reply);
      return previous.length >= FALLBACK_REPEAT_MIN_CHARS
        && (current === previous || tokenOverlap(reply, message.text) >= FALLBACK_REPEAT_OVERLAP);
    });
}

function selectRepeatSafeFallbackReply(
  context: ConversationDecisionContext,
  baseReply: string,
  alternateReplies: string[],
): string {
  const candidates = [baseReply, ...alternateReplies];
  return candidates.find((reply) => !repeatsRecentAssistantReply(reply, context)) ?? candidates[candidates.length - 1];
}

function hasWorkQuestion(text: string): boolean {
  const normalized = normalize(text);
  return /(nasil|ne yapacagim|hesap|profil|is|calisma|kamera|mesajlasma|anlamadim|kazanc|para|odeme|puan|garanti|kesin)/u.test(normalized);
}

function hasDisrespectfulCandidateTone(text: string): boolean {
  const normalized = normalize(text);
  return (
    /\b(ahraz|cakal|cakkal|salak|aptal|gerizekali|gerizekalı|mal|embesil|siktir|amk|aq|orospu|pic|piç)\b/u.test(normalized) ||
    /\blan\b.{0,30}\b(cakal|cakkal|salak|aptal|mal|ne anlatiyon|ne anlatÄ±yon|ne anlatiyorsun)\b/u.test(normalized)
  );
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
  const structured = context.canonical_policy_facts.find((fact) => fact.id.startsWith("structured_app_job_definition_"));
  if (structured) {
    const match = structured.content.match(/Approved app:\s*([^.]+)\./i);
    if (match?.[1]) return match[1].trim();
  }
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
  const groundedMissing: string[] = [];
  if (context.candidate_state.age === null) groundedMissing.push("yas");
  if (context.candidate_state.gender === null) groundedMissing.push("cinsiyet");
  if (context.candidate_state.daily_hours === null) groundedMissing.push("gunluk ayirabilecegin sure");
  const groundedNextPart = groundedMissing.length > 0
    ? `Devam edebilmem icin ${groundedMissing.join(", ")} bilgisini netlestirelim.`
    : "Bu calisma modeli sana uygunsa kuruluma gecmeden once bunu netlestirelim.";
  const groundedEarningsPart = asksEarnings
    ? "Kazanc veya odeme detayi icin dogrulanmis bilgi yoksa bunu uydurmadan ekip netlestirir. "
    : "";
  const groundedReply =
    `Isin temel kismi, ${app ? `${app} icinde ` : "onayli uygulama icinde "}gelen sohbet veya mesajlara yaziyla duzgun cevap vermek. ` +
    "Kamera/goruntulu calisma zorunlu diye bir kural soylemiyoruz; mesajlasma agirlikli ilerleyebilirsin. " +
    groundedEarningsPart +
    groundedNextPart;

  return {
    ...baseDecision(groundedReply, context, "deterministic_safety_response"),
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

function asksPaymentOrGuarantee(text: string): boolean {
  return /(kazanc|kazanÃ§|para|odeme|Ã¶deme|puan|garanti|kesin)/u.test(normalize(text));
}

function asksCameraAccountOrProfile(text: string): boolean {
  return /(kamera|goruntulu|gÃ¶rÃ¼ntÃ¼lÃ¼|video|hesap|hesabi|hesabÄ±|profil)/u.test(normalize(text));
}

function buildPaymentBoundarySafetyDecision(context: ConversationDecisionContext): ConversationDecision {
  const reply =
    "Dogrulanmis kazanc veya odeme detayi yok. Vaat vermeden ekip netlestirsin; biz yalnizca onayli uygulama icindeki mesajlasma surecini anlatabiliriz.";
  return {
    ...baseDecision(reply, context, "deterministic_safety_response"),
    intent: { primary: "payment_question", secondary: [], confidence: 1 },
    direct_question: {
      present: true,
      question_summary: "Aday kazanc veya odeme guvencesi soruyor",
      answered_in_reply: true,
    },
    chosen_actions: ["answer_user_question"],
    policy_facts_used: context.canonical_policy_facts.map((fact) => fact.id),
    next_action: "none",
    requires_escalation: true,
    escalation_reason: "payment_policy_missing",
  };
}

function buildCameraAccountBoundarySafetyDecision(context: ConversationDecisionContext): ConversationDecision {
  const reply =
    "Kamera veya goruntulu calisma zorunlu diye onayli kural soylemiyoruz. Erkek hesap/profil acma zorunlulugu da dogrulanmis degil; ekip bu detayi uydurmadan netlestirsin.";
  return {
    ...baseDecision(reply, context, "deterministic_safety_response"),
    intent: { primary: "account_profile_question", secondary: [], confidence: 1 },
    direct_question: {
      present: true,
      question_summary: "Aday kamera, hesap veya profil zorunlulugunu soruyor",
      answered_in_reply: true,
    },
    chosen_actions: ["answer_user_question"],
    policy_facts_used: context.canonical_policy_facts.map((fact) => fact.id),
    next_action: "none",
    requires_escalation: false,
    escalation_reason: null,
  };
}

export function buildCandidateToneBoundaryDecision(context: ConversationDecisionContext): ConversationDecision | null {
  if (context.role !== "candidate" || context.channel !== "private") return null;
  if (!hasDisrespectfulCandidateTone(context.latest_message.text)) return null;

  const reply =
    "Sana yardimci olurum ama bu sekilde konusmayalim. Calisma modeli veya sorununu net yazarsan isi ve sonraki adimi kisa, dogru sekilde anlatirim.";

  return {
    ...baseDecision(reply, context, "deterministic_safety_response"),
    intent: { primary: "candidate_boundary_tone", secondary: [], confidence: 1 },
    direct_question: {
      present: false,
      question_summary: null,
      answered_in_reply: true,
    },
    chosen_actions: ["handle_user_frustration", "explain_work_model"],
    policy_facts_used: context.canonical_policy_facts.map((fact) => fact.id),
    next_action: "none",
    requires_escalation: false,
    escalation_reason: null,
  };
}

export function buildDeterministicSafetyDecision(
  context: ConversationDecisionContext,
  reason: "invalid_model_decision" | "provider_unavailable" | "policy_missing"
): ConversationDecision {
  if (reason === "invalid_model_decision" && asksPaymentOrGuarantee(context.latest_message.text)) {
    return buildPaymentBoundarySafetyDecision(context);
  }

  if (reason === "invalid_model_decision" && asksCameraAccountOrProfile(context.latest_message.text)) {
    return buildCameraAccountBoundarySafetyDecision(context);
  }

  if (reason === "invalid_model_decision" && context.latest_message.inferred_intent === "ask_job_definition") {
    return buildJobDefinitionSafetyDecision(context);
  }

  const baseReply = reason === "provider_unavailable"
    ? "Şu an yanıtı güvenli şekilde oluşturamadım. Yanlış yönlendirmemek için ekip bu mesajı netleştirsin."
    : reason === "policy_missing"
      ? "Bu konuda doğrulanmış bilgi eksik. Yanlış yönlendirmemek için ekip netleştirsin."
      : "Bu cevabı güvenli şekilde netleştiremedim. Yanlış yönlendirmemek için ekip kontrol etsin.";
  const topic = fallbackTopic(context);
  const reply = selectRepeatSafeFallbackReply(context, baseReply, [
    `Az önce de ${topic} için ekip kontrolü istemiştim. Yanlış yönlendirmemek için bu mesajı da aynı güvenli kontrolde tutuyorum.`,
    `${topic} hakkında doğrulanmamış cevap vermeyeceğim. Ekip netleştirene kadar güvenli sınırı koruyorum.`
  ]);
  return baseDecision(
    reply,
    context,
    reason === "provider_unavailable" ? "deterministic_transport_failure" : "deterministic_safety_response"
  );
}
