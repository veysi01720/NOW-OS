import type {
  ConversationContinuitySignals,
  ConversationalAnswerScope,
  ConversationalConfidence,
  ConversationalPrimaryIntent,
  ConversationalQualityContract,
  ConversationalTone,
  DesiredReplyLength,
  QualityValidationResult,
  ResponseObjective,
  ResponsePlannerInput,
} from "./types.js";

export interface QualityValidationOptions {
  recentAssistantReplies?: string[];
}

const GENERIC_SERVICE_PHRASES = [
  "degerli kullanicimiz",
  "sizlere yardimci olmaktan mutluluk duyariz",
  "baska bir konuda yardimci olabilir miyim",
  "asagidaki adimlari dikkatlice takip ediniz",
  "oncelikle sistemimizin isleyisinden bahsedelim",
  "yardimci olabilecegim baska konu varsa yazabilirsin",
  "destek icin buradayim",
  "baska bir sorun varsa yardimci olabilirim",
  "yoneticine danisabilirsin"
];

const OWNER_ADDRESS_PATTERN = /\b(sef|dayi|patron)\b/iu;
const UNSUPPORTED_REFERENCE_PATTERNS = [
  /referans\s+(paylaşabileceğimi|paylasabilecegimi|paylaşabileceğinizi|paylasabileceginizi|paylaşabilirim|paylasabilirim|gösterebilirim|gosterebilirim)/iu,
  /daha\s+önce\s+başlayanlardan\s+referans/iu,
  /daha\s+once\s+baslayanlardan\s+referans/iu,
  /referans\s+da\s+paylaşabilirim/iu,
  /referans\s+da\s+paylasabilirim/iu,
  /kazanç\s+kanıtı/iu,
  /kazanc\s+kaniti/iu,
];

const RISKY_HARD_CLAIM_PATTERNS = [
  /\bgaranti\b/iu,
  /kesin\s+güven/iu,
  /kesin\s+guven/iu,
  /sorun\s+yaşamazsınız/iu,
  /sorun\s+yasamazsiniz/iu,
];

const TEXT_ONLY_RESTATEMENT_PATTERNS = [
  /görüntülü\s+zorunlu\s+değil/iu,
  /goruntulu\s+zorunlu\s+degil/iu,
  /tamamen\s+metin\s+tabanlı\s+çalışabilir/iu,
  /tamamen\s+metin\s+tabanli\s+calisabilir/iu,
];

function hasOwnerAddress(text: string): boolean {
  return OWNER_ADDRESS_PATTERN.test(normalize(text));
}

function normalize(text: string): string {
  return text
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ı", "i")
    .replaceAll("İ", "i")
    .replaceAll("ğ", "g")
    .replaceAll("ü", "u")
    .replaceAll("ş", "s")
    .replaceAll("ö", "o")
    .replaceAll("ç", "c");
}

function includesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function classifyConversationalIntent(input: ResponsePlannerInput): ConversationalPrimaryIntent {
  const text = normalize(input.normalizedText);
  const intent = normalize(input.answerPlan?.intent ?? "");

  if (input.isGroup && !input.isAuthorized) return "irrelevant_message";
  if (input.senderRole === "owner" || input.senderRole === "manager") {
    if (text.startsWith("#") || intent.includes("training") || intent.includes("report")) return "manager_instruction";
  }
  if (input.answerPlan?.escalation_required === true) return "handoff_required";
  if (includesAny(text, [/insan/, /operator/, /yonetici/, /biri baksin/, /destek/])) return "handoff_required";
  if (includesAny(text, [/guven/, /dolandir/, /suphe/, /risk/, /emin degil/])) return "trust_objection";
  if (includesAny(text, [/guvenli/, /kimlik/, /dogrula/, /hesap guven/])) return "safety_concern";
  if (includesAny(text, [/odeme/, /para/, /cek(i|ı)m/, /ne zaman yatar/])) return "payment_question";
  if (includesAny(text, [/kazanc/, /kazanirim/, /bonus/, /maas/])) return "earnings_question";
  if (includesAny(text, [/sadece mesaj/, /mesajlas/, /kamera acmadan/, /goruntulu istem/])) return "work_method_question";
  if (includesAny(text, [/hangi uygulama/, /uygulama sec/, /layla|soyo|amar|timo/])) return "application_selection";
  if (includesAny(text, [/indirdim/, /profil foto/, /kodu girdim/, /sonra ne/])) return "installation_help";
  if (includesAny(text, [/takildim/, /yapamadim/, /olmadi/, /olmuyor/, /hata/])) return "installation_blocked";
  if (includesAny(text, [/bilmiyorum/, /anlamadim/, /nerede kaldim/])) return "confused_user";
  if (includesAny(text, [/sinir/, /kizdim/, /sikayet/, /yeter/])) return "angry_user";
  if (includesAny(text, [/tekrar/, /yine/, /bir daha/]) || input.completedTopics.includes(input.answerPlan?.intent ?? "")) {
    return "repeat_question";
  }
  if (includesAny(text, [/nasil bas/, /baslayalim/, /kayit/, /ne yapmaliyim/])) return "application_start";
  if (text.includes("?") || includesAny(text, [/\b(ne|nasil|neden|nerede|hangi|kac|mi|mu)\b/])) {
    return "direct_information";
  }
  if (text.length <= 3 || includesAny(text, [/tamam/, /ok/, /merhaba/, /selam/])) return "followup_question";
  return "unknown_intent";
}

function answerScopeFor(objective: ResponseObjective, intent: ConversationalPrimaryIntent): ConversationalAnswerScope {
  if (objective === "escalate" || intent === "handoff_required") return "escalate";
  if (objective === "reassure" || intent === "trust_objection" || intent === "safety_concern") return "reassure";
  if (objective === "guide" || intent === "installation_blocked") return "troubleshoot";
  if (objective === "clarify" || intent === "confused_user" || intent === "unknown_intent") return "clarify";
  if (intent === "application_start" || intent === "installation_help") return "answer_then_next_step";
  return "direct_answer";
}

function toneFor(input: ResponsePlannerInput, intent: ConversationalPrimaryIntent): ConversationalTone {
  if (input.senderRole === "owner" || input.senderRole === "manager") return "managerial";
  if (intent === "trust_objection" || intent === "safety_concern") return "reassuring";
  if (intent === "installation_help" || intent === "installation_blocked") return "instructional";
  if (intent === "angry_user") return "firm";
  return "natural";
}

function confidenceFor(input: ResponsePlannerInput, intent: ConversationalPrimaryIntent): ConversationalConfidence {
  const sourceCount = input.answerPlan?.source_count ?? 0;
  if (input.answerPlan?.escalation_required || intent === "unknown_intent") return "low";
  if (sourceCount > 0 || intent === "repeat_question") return "high";
  return "medium";
}

function continuitySignals(input: ResponsePlannerInput, repeatedIntent: boolean): ConversationContinuitySignals {
  const factsAlreadyGiven = input.completedTopics.filter((topic) =>
    /code|kod|app|uygulama|layla|linky|nivi/i.test(topic),
  ).slice(0, 5);
  const stepsAlreadyCompleted = input.completedTopics.filter((topic) =>
    /install|kurulum|profil|phone|telefon|selected_app/i.test(topic),
  ).slice(0, 5);
  const userPreferencesKnown = [...input.completedTopics, ...input.pendingTopics].filter((topic) =>
    /iphone|android|mesaj|kamera|goruntulu|görüntülü/i.test(topic),
  ).slice(0, 5);

  return {
    factsAlreadyGiven,
    stepsAlreadyCompleted,
    userPreferencesKnown,
    repeatedIntent,
    lastAssistantGoal: input.lastResolvedIntent ?? undefined,
  };
}

function responseGoalFor(intent: ConversationalPrimaryIntent, scope: ConversationalAnswerScope): string {
  if (scope === "direct_answer") return "Answer only the asked item.";
  if (scope === "answer_then_next_step") return "Answer briefly, then give only the next useful step.";
  if (scope === "reassure") return "Acknowledge concern, use safe facts, and keep user control clear.";
  if (scope === "troubleshoot") return "Use current stage and give the next troubleshooting step.";
  if (scope === "escalate") return "Do not invent details; route to human/operator support.";
  return "Ask one targeted clarification question.";
}

function mustAvoidFor(intent: ConversationalPrimaryIntent, avoidRepetition: boolean): string[] {
  const avoid = [
    "raw_internal_metadata",
    "unsupported_claims",
    "guaranteed_earnings_or_absolute_safety",
    "generic_customer_service_script",
    "unnecessary_greeting",
    "unnecessary_followup",
  ];
  if (avoidRepetition) avoid.push("repeating_previous_answer_word_for_word");
  if (intent === "work_method_question") avoid.push("forcing_camera_or_voice_call");
  if (intent === "trust_objection") avoid.push("defensive_or_pressure_language");
  return avoid;
}

function mustIncludeFor(intent: ConversationalPrimaryIntent, scope: ConversationalAnswerScope): string[] {
  if (intent === "trust_objection") return ["acknowledge_concern", "safe_next_step"];
  if (intent === "work_method_question") return ["respect_user_preference"];
  if (scope === "escalate") return ["safe_handoff"];
  if (intent === "repeat_question") return ["brief_reference_to_previous_answer"];
  return [];
}

export function buildConversationalQualityContract(
  input: ResponsePlannerInput,
  plan: {
    objective: ResponseObjective;
    desiredLength: DesiredReplyLength;
    mayAskQuestion: boolean;
    shouldAvoidRepetition: boolean;
  },
): ConversationalQualityContract {
  const primaryIntent = classifyConversationalIntent(input);
  const answerScope = answerScopeFor(plan.objective, primaryIntent);
  const confidence = confidenceFor(input, primaryIntent);
  const repeatedIntent = plan.shouldAvoidRepetition || primaryIntent === "repeat_question";
  const escalationRequired = answerScope === "escalate" || confidence === "low";

  return {
    contractVersion: "1.0",
    primaryIntent,
    conversationStage: input.currentUserStage,
    responseGoal: responseGoalFor(primaryIntent, answerScope),
    answerScope,
    tone: toneFor(input, primaryIntent),
    lengthBudget: plan.desiredLength,
    mustInclude: mustIncludeFor(primaryIntent, answerScope),
    mustAvoid: mustAvoidFor(primaryIntent, repeatedIntent),
    askFollowup: plan.mayAskQuestion && (answerScope === "clarify" || confidence !== "high"),
    followupPurpose: plan.mayAskQuestion && (answerScope === "clarify" || confidence !== "high") ? "ask_one_targeted_question" : undefined,
    useConversationHistory: true,
    avoidRepetition: repeatedIntent,
    escalationRequired,
    escalationReason: escalationRequired ? primaryIntent : undefined,
    confidence,
    continuitySignals: continuitySignals(input, repeatedIntent),
  };
}

export function validateConversationalReplyQuality(
  reply: string,
  internalBossNote: string,
  quality: ConversationalQualityContract,
  options: QualityValidationOptions = {},
): QualityValidationResult {
  const violations: string[] = [];
  const normalizedReply = normalize(reply);

  if (reply.trim() === "") violations.push("empty_reply");
  if (internalBossNote.trim() && reply.includes(internalBossNote.trim())) violations.push("internal_note_leak");
  if (quality.lengthBudget === "very_short" && reply.split(/[.!?\n]+/).filter((part) => part.trim()).length > 2) {
    violations.push("very_short_budget_exceeded");
  }
  if (quality.lengthBudget === "short" && reply.split(/[.!?\n]+/).filter((part) => part.trim()).length > 5) {
    violations.push("short_budget_exceeded");
  }
  if (/(kesin guvenli|hic risk yok|garanti kazanc|kesin kazanirsin)/i.test(normalizedReply)) {
    violations.push("unsupported_absolute_claim");
  }
  if (UNSUPPORTED_REFERENCE_PATTERNS.some((pattern) => pattern.test(reply))) {
    violations.push("UNSUPPORTED_REFERENCE_OFFER");
  }
  if (RISKY_HARD_CLAIM_PATTERNS.some((pattern) => pattern.test(reply))) {
    violations.push("UNSUPPORTED_HARD_CLAIM");
  }
  if (TEXT_ONLY_RESTATEMENT_PATTERNS.some((pattern) => pattern.test(reply))) {
    violations.push("UNNECESSARY_CONTEXT_RESTATEMENT");
  }
  if (GENERIC_SERVICE_PHRASES.some((phrase) => normalizedReply.includes(phrase))) {
    violations.push("GENERIC_SUPPORT_FALLBACK");
  }
  if (/(erkek profil\w*\s+aç|erkek hesab\w*\s+aç)/i.test(normalizedReply)) {
    violations.push("UNGROUNDED_ACCOUNT_MODEL");
  }
  if (quality.conversationStage === "new" || quality.conversationStage === "exploring") {
    if (/(layla|soyo|amar|timo)/i.test(normalizedReply)) {
      violations.push("APPLICATION_DISCLOSED_TOO_EARLY");
    }
  }
  
  if (quality.tone !== "managerial" && /^(sef|dayi|patron)\b/.test(normalizedReply)) {
    violations.push("authority_title_for_non_managerial_reply");
  }
  if (quality.tone === "managerial" && hasOwnerAddress(reply)) {
    const recentOwnerAddressCount = (options.recentAssistantReplies ?? [])
      .slice(-2)
      .filter((recentReply) => hasOwnerAddress(recentReply))
      .length;
    if (recentOwnerAddressCount >= 1) {
      violations.push("REPEATED_OWNER_ADDRESS");
    }
  }

  const paragraphs = reply.split(/\n+/).map((part) => part.trim()).filter(Boolean);
  if (new Set(paragraphs).size !== paragraphs.length) violations.push("MECHANICAL_RESPONSE");

  const sefCount = (normalizedReply.match(/\b(sef|dayi|patron)\b/g) || []).length;
  if (sefCount > 2) {
    violations.push("excessive_title_usage");
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}
