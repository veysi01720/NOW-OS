import type { SenderRole } from "../config/roles.js";
import type { ChatType } from "../contracts/backendContextPayload.js";

export type CoreMode =
  | "answer_mode"
  | "training_mode"
  | "test_mode"
  | "authority_command_mode"
  | "zip_ingestion_mode"
  | "knowledge_candidate_mode"
  | "link_request_mode";

export type CoreIntent =
  | "app_routing"
  | "app_setup"
  | "invite_code"
  | "payment_withdrawal"
  | "trust_objection"
  | "link_request"
  | "technical_issue"
  | "ban_issue"
  | "manager_escalation"
  | "owner_training_instruction"
  | "owner_test"
  | "group_policy_command"
  | "zip_ingestion"
  | "normal_chat";

export interface ModeRoute {
  mode: CoreMode;
  intent: CoreIntent;
  prefix?: string;
  assistant_run_skipped: boolean;
  skip_reason?: string;
  deterministic_reply?: string;
}

export function detectCommandPrefix(text: string): string | null {
  const normalized = normalize(text);
  const match = normalized.match(/^(#komut|#kural|#egitim|#zip|#test|#bilgi)(\s|$)/);
  return match?.[1] ?? null;
}

function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replaceAll("ı", "i")
    .replaceAll("İ", "i");
}

function addressFor(role: SenderRole): string {
  return role === "manager" ? "dayi" : "patron";
}

export function routeCoreMode(input: {
  text: string;
  senderRole: SenderRole;
  chatType: ChatType;
}): ModeRoute {
  const text = normalize(input.text);
  const isAuthority = input.senderRole === "owner" || input.senderRole === "manager";

  if (isAuthority && (text.startsWith("#kural") || text.startsWith("#egitim"))) {
    return {
      mode: "training_mode",
      intent: "owner_training_instruction",
      prefix: text.startsWith("#kural") ? "#kural" : "#egitim",
      assistant_run_skipped: true,
      skip_reason: "training_prefix_acknowledged",
      deterministic_reply: `${addressFor(input.senderRole)} kurali aldim.`
    };
  }

  if (isAuthority && text.startsWith("#test")) {
    return {
      mode: "test_mode",
      intent: "owner_test",
      prefix: "#test",
      assistant_run_skipped: false
    };
  }

  if (isAuthority && text.startsWith("#komut")) {
    return {
      mode: "authority_command_mode",
      intent: "group_policy_command",
      prefix: "#komut",
      assistant_run_skipped: true,
      skip_reason: "authority_command_handled",
      deterministic_reply: `${addressFor(input.senderRole)} komutu net algilayamadim. Ornek: #komut sistem durumu`
    };
  }

  if (isAuthority && text.startsWith("#zip")) {
    return {
      mode: "zip_ingestion_mode",
      intent: "zip_ingestion",
      prefix: "#zip",
      assistant_run_skipped: true,
      skip_reason: "zip_mode_reserved",
      deterministic_reply: `${addressFor(input.senderRole)} zip modu simdilik ayrildi; otomatik isleme alinmadi.`
    };
  }

  if (isAuthority && text.startsWith("#bilgi")) {
    return {
      mode: "knowledge_candidate_mode",
      intent: "normal_chat",
      prefix: "#bilgi",
      assistant_run_skipped: false
    };
  }

  if (/(^|\s)(link|linki|url|indirme)(\s|$)/.test(text)) {
    return { mode: "link_request_mode", intent: "link_request", assistant_run_skipped: false };
  }

  if (/\b(kod|davet|ajans kodu|invite)\b/.test(text)) {
    return { mode: "answer_mode", intent: "invite_code", assistant_run_skipped: false };
  }

  if (/(guven|güven|guvenli|güvenli|gercek mi|dolandir|odeme|ödeme|cek|çek|para)/.test(text)) {
    return {
      mode: "answer_mode",
      intent: /(odeme|ödeme|cek|çek|para)/.test(text) ? "payment_withdrawal" : "trust_objection",
      assistant_run_skipped: false
    };
  }

  if (/\b(timo)\b/.test(text) && /\b(detay|anlat|nasil|nasıl)\b/.test(text)) {
    return { mode: "answer_mode", intent: "manager_escalation", assistant_run_skipped: false };
  }

  if (/(kamera|mesaj|mesajlas|mesajlaş|video|ses|aktif)/.test(text)) {
    return { mode: "answer_mode", intent: "app_routing", assistant_run_skipped: false };
  }

  if (/\b(yapamadim|yapamadım|olmuyor|hata|takildim|takıldım|acilmiyor|açılmıyor)\b/.test(text)) {
    return { mode: "answer_mode", intent: "technical_issue", assistant_run_skipped: false };
  }

  if (/\b(ban|askiya|askıya|suspend)\b/.test(text)) {
    return { mode: "answer_mode", intent: "ban_issue", assistant_run_skipped: false };
  }

  return { mode: "answer_mode", intent: "normal_chat", assistant_run_skipped: false };
}
