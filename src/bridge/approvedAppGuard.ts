import type { BackendContextPayloadV1 } from "../contracts/backendContextPayload.js";

export const SAFE_APPROVED_APP_GATE_REPLY =
  "Anladım. Uygulama adını netleştirmeden yanlış yönlendirme yapmak istemem. Ekip hangi uygulama üzerinden ilerlemeni söylediyse onu yaz, ben de ona göre adım adım yardımcı olayım.";

export const DEFAULT_UNAPPROVED_APP_TERMS = [
  "TikTok",
  "Instagram",
  "Twitch",
  "YouTube",
  "Sozzy",
  "Chatrace",
  "NovaChat"
];

export interface ApprovedAppGuardResult {
  ok: boolean;
  term_count: number;
}

export interface ApprovedAppVocabularyInput {
  allowed_apps: string[];
  selected_app?: string | null;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("tr-TR").trim();
}

function containsTerm(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, "iu").test(text);
}

export function checkApprovedAppVocabulary(
  reply: string,
  vocabulary: ApprovedAppVocabularyInput,
  unapprovedTerms = DEFAULT_UNAPPROVED_APP_TERMS
): ApprovedAppGuardResult {
  const approved = new Set(
    [...vocabulary.allowed_apps, vocabulary.selected_app ?? ""].filter(Boolean).map(normalize)
  );

  const termCount = unapprovedTerms.filter((term) => {
    if (approved.has(normalize(term))) {
      return false;
    }
    return containsTerm(reply, term);
  }).length;

  return {
    ok: termCount === 0,
    term_count: termCount
  };
}

export function checkApprovedAppGate(
  reply: string,
  backendContext: BackendContextPayloadV1,
  unapprovedTerms = DEFAULT_UNAPPROVED_APP_TERMS
): ApprovedAppGuardResult {
  return checkApprovedAppVocabulary(reply, {
    allowed_apps: backendContext.allowed_apps,
    selected_app: backendContext.state.selected_app,
  }, unapprovedTerms);
}
