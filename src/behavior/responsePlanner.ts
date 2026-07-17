import type { ResponsePlan, ResponsePlannerInput } from "./types.js";
import { buildConversationalQualityContract } from "./conversationalQuality.js";

const DEFAULT_FORBIDDEN_TOPICS = [
  "internal_boss_note",
  "raw_backend_metadata",
  "raw_phone",
  "raw_remote_jid",
  "raw_group_id",
  "secret_or_token",
  "guaranteed_earnings",
];

function normalize(text: string): string {
  return text
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ı", "i")
    .replaceAll("İ", "i");
}

function isQuestion(text: string): boolean {
  return (
    text.includes("?") ||
    /\b(ne|nasil|nasıl|neden|nerede|nereye|hangi|kim|kac|kaç|mi|mı|mu|mü)\b/.test(text)
  );
}

function hasTrustHesitation(text: string): boolean {
  return /(guven|güven|guvenli|güvenli|dolandir|dolandır|emin|risk|suphe|şüphe)/.test(text);
}

function hasGuideIntent(text: string): boolean {
  return /(ne yap|nasil bas|nasıl baş|nasil iler|nasıl iler|nereden bas|nereden baş|bilmiyorum|anlamadim|anlamadım)/.test(text);
}

function hasMessagingPreference(text: string): boolean {
  return /(sadece mesaj|mesajlas|kamera acmadan|goruntulu istem)/.test(text);
}

function hasSupportOrEscalation(text: string, input: ResponsePlannerInput): boolean {
  if (input.answerPlan?.escalation_required === true) return true;
  return /(takildim|takıldım|yapamadim|yapamadım|olmuyor|hata|sikayet|şikayet|ban|askiya|askıya|insan|operator|destek)/.test(text);
}

function isCasual(text: string): boolean {
  return /^(selam|merhaba|mrb|sa|slm|tamam|ok|eyvallah|tesekkur|teşekkür)[.! ]*$/.test(text);
}

function isShort(text: string): boolean {
  return text.length <= 24 || text.split(/\s+/).filter(Boolean).length <= 3;
}

function repeatsKnownTopic(text: string, input: ResponsePlannerInput): boolean {
  const haystack = normalize([...input.completedTopics, ...input.pendingTopics, input.lastResolvedIntent ?? ""].join(" "));
  if (haystack.trim() === "") return false;
  return normalize(text)
    .split(/\s+/)
    .filter((word) => word.length >= 4)
    .some((word) => haystack.includes(word));
}

export function planResponse(input: ResponsePlannerInput): ResponsePlan {
  const text = normalize(input.normalizedText);
  const groupCommand = input.isGroup && input.normalizedText.trim().startsWith("#");

  if ((input.isGroup && !groupCommand) || (groupCommand && !input.isAuthorized)) {
    const basePlan = {
      objective: "ignore" as const,
      desiredLength: "very_short" as const,
      mayAskQuestion: false,
      shouldAvoidRepetition: false,
    };
    return {
      objective: basePlan.objective,
      desiredLength: basePlan.desiredLength,
      mayAskQuestion: basePlan.mayAskQuestion,
      shouldUseKnowledge: false,
      shouldAcknowledgeEmotion: false,
      shouldAvoidRepetition: basePlan.shouldAvoidRepetition,
      forbiddenTopics: [...DEFAULT_FORBIDDEN_TOPICS],
      requiresModelCall: false,
      quality: buildConversationalQualityContract(input, basePlan),
    };
  }

  const supportOrEscalation = hasSupportOrEscalation(text, input);
  const trustHesitation = hasTrustHesitation(text);
  const guideIntent = hasGuideIntent(text);
  const messagingPreference = hasMessagingPreference(text);
  const casual = isCasual(text);
  const question = isQuestion(text) || input.answerPlan?.intent === "invite_code" || input.answerPlan?.intent === "link_request";
  const repetition = repeatsKnownTopic(text, input) || input.completedTopics.includes(input.answerPlan?.intent ?? "");

  let objective: ResponsePlan["objective"] = "clarify";
  if (supportOrEscalation) objective = input.answerPlan?.escalation_required ? "escalate" : "guide";
  else if (trustHesitation) objective = "reassure";
  else if (messagingPreference) objective = "answer";
  else if (guideIntent) objective = "guide";
  else if (question) objective = "answer";
  else if (casual) objective = "encourage";

  const shouldUseKnowledge =
    !casual &&
    (question || guideIntent || trustHesitation || messagingPreference || supportOrEscalation || (input.answerPlan?.source_count ?? 0) > 0);

  const basePlan = {
    objective,
    desiredLength: isShort(text) || casual ? "very_short" as const : "short" as const,
    mayAskQuestion: objective !== "escalate",
    shouldAvoidRepetition: repetition,
  };

  return {
    objective,
    desiredLength: basePlan.desiredLength,
    mayAskQuestion: basePlan.mayAskQuestion,
    shouldUseKnowledge,
    shouldAcknowledgeEmotion: trustHesitation || supportOrEscalation || input.unresolvedObjections.length > 0,
    shouldAvoidRepetition: basePlan.shouldAvoidRepetition,
    forbiddenTopics: [...DEFAULT_FORBIDDEN_TOPICS],
    requiresModelCall: true,
    quality: buildConversationalQualityContract(input, basePlan),
  };
}

