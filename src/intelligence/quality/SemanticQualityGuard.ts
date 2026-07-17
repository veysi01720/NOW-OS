import type { ConversationDecisionContext } from "../conversation/ConversationDecisionSchema.js";

export interface SemanticQualityResult {
  ok: boolean;
  reason_codes: string[];
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("tr-TR").normalize("NFKD").replace(/\p{M}/gu, "").replace(/ı/gu, "i");
}

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

function latestAssistantReply(context: ConversationDecisionContext): string | null {
  for (let index = context.recent_messages.length - 1; index >= 0; index -= 1) {
    const item = context.recent_messages[index];
    if (item.role === "assistant") return item.text;
  }
  return null;
}

function isFirstContactIntent(intent: string | null | undefined): boolean {
  return intent === "greeting_or_first_contact" || intent === "candidate_first_contact";
}

function isJobDefinitionIntent(intent: string | null | undefined): boolean {
  return intent === "ask_job_definition";
}

function hasGenericConversationCloser(text: string): boolean {
  return /((baska|başka)\s+((sormak\s+istedigin|sormak\s+istediğin|sorun|merak\s+ettigin|merak\s+ettiğin)|(bir\s+sey|bir\s+şey)|(ne\s+ogrenmek|ne\s+öğrenmek))|yardimci\s+olabilecegim\s+baska|yardımcı\s+olabileceğim\s+başka|detay\s+ister\s+misin).{0,40}(var\s+mi|var\s+mı|ister\s+misin|\?)/u.test(text);
}

const KNOWN_APP_NAMES = ["layla", "soyo", "amar", "timo", "linky"];

function mentionedApps(text: string): string[] {
  return KNOWN_APP_NAMES.filter((app) => new RegExp(`(^|\\b)${app}($|\\b)`, "u").test(text));
}

function appMentionGrounded(reply: string, context: ConversationDecisionContext): boolean {
  const apps = mentionedApps(reply);
  if (apps.length === 0) return true;
  const selectedApp = context.candidate_state.selected_app;
  const selected = selectedApp ? normalize(selectedApp) : null;
  const latest = normalize(context.latest_message.text);
  const policyText = normalize(context.canonical_policy_facts.map((fact) => `${fact.fact} ${fact.content}`).join("\n"));

  return apps.every((app) => {
    if (selected === app) return true;
    if (latest.includes(app)) return true;
    return policyText.includes(app);
  });
}

function jobExplanationComplete(reply: string, context: ConversationDecisionContext): boolean {
  const hasInteraction = /(sohbet|mesaj|yazi|yazı|iletisim|iletişim|cevap)/u.test(reply);
  const hasUserTask = /(cevap|yanit|yanıt|yaziyla|yazıyla|yazis|yazış|yazili|yazılı)/u.test(reply);
  const hasModeBoundary = /(kamera|goruntulu|görüntülü|zorunlu|istege bagli|isteğe bağlı|mesajlasma|mesajlaşma|yaziyla|yazıyla|yazili|yazılı)/u.test(reply);
  const hasNextStep = /(yas|yaş|cinsiyet|saat|uygun|netlestir|netleştir|devam|sonraki|kabul|adim|adım)/u.test(reply);
  const mentionsEarning = /(kazanc|kazanç|puan|odeme|ödeme|para)/u.test(reply);
  const earningFactsAvailable = context.canonical_policy_facts.some((fact) => /(kazanc|kazanç|puan|odeme|ödeme|para)/u.test(normalize(`${fact.fact} ${fact.content}`)));
  const earningBoundary =
    /(dogrulanmis\s+bilgi\s+yok|doğrulanmış\s+bilgi\s+yok|dogrulanmis\s+bilgi\s+disina|doğrulanmış\s+bilgi\s+dışına|uydurmuyoruz|uydurmayalim|uydurmayalım|kesin\s+(soz|söz)\s+vermiyoruz)/u.test(reply);
  const earningOk = earningFactsAvailable ? mentionsEarning : !mentionsEarning || earningBoundary;
  return hasInteraction && hasUserTask && hasModeBoundary && hasNextStep && earningOk;
}

export function validateSemanticQuality(reply: string, context: ConversationDecisionContext): SemanticQualityResult {
  const text = normalize(reply);
  const reasons: string[] = [];

  if (hasGenericConversationCloser(text)) {
    reasons.push("GENERIC_CONVERSATION_CLOSER");
  }
  if (/(kurulum icin hazirsin|kuruluma hazirsin|baslamak ister misin)/u.test(text) && context.candidate_state.work_model_acceptance !== "accepted") {
    reasons.push("INSTALLATION_OFFERED_TOO_EARLY");
  }
  const setupMentioned = /(davet kodu|indir|link|profil kurulumu|profil ac|profil aç|telefon kurulumu)/u.test(text);
  const setupBoundaryAnswer = /(yok|degil|değil|uydurmayalim|uydurmayalım|dogrulanmis kural yok|doğrulanmış kural yok)/u.test(text);
  if (setupMentioned && !setupBoundaryAnswer && context.candidate_state.work_model_acceptance !== "accepted") {
    reasons.push("MODEL_ACCEPTANCE_BYPASSED");
  }
  if (/(garanti|kesin guven|sorun yasamazsiniz|kazanc kaniti|referans paylasabilirim|referans gosterebilirim)/u.test(text)) {
    reasons.push("UNSUPPORTED_CLAIM");
  }
  if (!appMentionGrounded(text, context)) {
    reasons.push("UNGROUNDED_APP_SELECTION");
  }
  if (isJobDefinitionIntent(context.latest_message.inferred_intent) && !jobExplanationComplete(text, context)) {
    reasons.push("JOB_EXPLANATION_INCOMPLETE");
  }
  if (
    context.derived_state.intake_complete &&
    context.candidate_state.work_model_acceptance !== "accepted" &&
    !isFirstContactIntent(context.latest_message.inferred_intent)
  ) {
    const latestLooksLikeQuestion = /(nasil|nasıl|ne|mi|mu|mı|mü|\?)/u.test(normalize(context.latest_message.text));
    const hasWorkModelSignal = /(calisma modeli|sohbet|mesajlasma|kamera acmadan|uygun mu|kabul)/u.test(text);
    if (!latestLooksLikeQuestion && !hasWorkModelSignal) reasons.push("WORK_MODEL_NOT_DISCLOSED");
  }
  if (context.latest_message.inferred_intent === "clarify_previous_explanation") {
    const previous = latestAssistantReply(context);
    if (previous) {
      const previousText = normalize(previous);
      if (text === previousText || tokenOverlap(reply, previous) >= 0.72) {
        reasons.push("CLARIFICATION_REPLY_REPEATED");
      }
    }
  }

  return { ok: reasons.length === 0, reason_codes: [...new Set(reasons)] };
}
