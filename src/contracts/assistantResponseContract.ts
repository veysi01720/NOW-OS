export const ASSISTANT_RESPONSE_CONTRACT_VERSION = "1.0" as const;
export const SUPPORTED_ASSISTANT_RESPONSE_CONTRACT_VERSION = "1.0" as const;
export const ASSISTANT_SAFE_FALLBACK_REPLY =
  "Şu an mesajını işlerken küçük bir teknik sorun oluştu. Birazdan tekrar yardımcı olacağım.";
export const ASSISTANT_REPLY_MAX_LENGTH = 2000;
export const ASSISTANT_INTERNAL_NOTE_MAX_LENGTH = 1000;

export interface AssistantResponseV1 {
  contract_version: typeof ASSISTANT_RESPONSE_CONTRACT_VERSION;
  reply: string;
  internal_boss_note: string;
}

export interface AssistantResponseValidationError {
  code:
    | "EMPTY_RESPONSE"
    | "INVALID_JSON"
    | "NOT_OBJECT"
    | "ARRAY_NOT_ALLOWED"
    | "CODE_FENCE_NOT_ALLOWED"
    | "MISSING_CONTRACT_VERSION"
    | "INVALID_CONTRACT_VERSION_TYPE"
    | "UNSUPPORTED_CONTRACT_VERSION"
    | "MISSING_REPLY"
    | "MISSING_INTERNAL_BOSS_NOTE"
    | "INVALID_REPLY_TYPE"
    | "INVALID_INTERNAL_BOSS_NOTE_TYPE"
    | "EMPTY_REPLY"
    | "INTERNAL_NOTE_LEAK_RISK"
    | "REPLY_TOO_LONG"
    | "INTERNAL_NOTE_TOO_LONG";
  message: string;
  raw_preview?: string;
}

export type AssistantResponseParseResult =
  | { ok: true; value: AssistantResponseV1 }
  | { ok: false; error: AssistantResponseValidationError };

function preview(raw: string): string {
  return raw.slice(0, 300);
}

function invalid(
  code: AssistantResponseValidationError["code"],
  message: string,
  raw?: string
): AssistantResponseParseResult {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(raw !== undefined ? { raw_preview: preview(raw) } : {})
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasInternalNoteLeakRisk(reply: string): boolean {
  const lowered = reply.toLocaleLowerCase("tr-TR");
  return [
    "internal_boss_note",
    "internal boss note",
    "internal note",
    "boss note",
    "ic not",
    "iç not",
    "yönetici notu",
    "operatör notu"
  ].some((needle) => lowered.includes(needle));
}

export function parseAssistantResponseV1(rawResponse: string | null | undefined): AssistantResponseParseResult {
  if (rawResponse === null || rawResponse === undefined || rawResponse.trim() === "") {
    return invalid("EMPTY_RESPONSE", "Assistant response is empty", rawResponse ?? "");
  }

  const raw = rawResponse.trim();

  if (raw.startsWith("```") || raw.endsWith("```")) {
    return invalid("CODE_FENCE_NOT_ALLOWED", "Markdown code fence is not allowed", raw);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return invalid("INVALID_JSON", "Assistant response must be valid JSON", raw);
  }

  if (Array.isArray(parsed)) {
    return invalid("ARRAY_NOT_ALLOWED", "Assistant response must not be an array", raw);
  }

  if (!isRecord(parsed)) {
    return invalid("NOT_OBJECT", "Assistant response must be a JSON object", raw);
  }

  if (!("contract_version" in parsed)) {
    return invalid("MISSING_CONTRACT_VERSION", "contract_version is required", raw);
  }

  if (typeof parsed.contract_version !== "string") {
    return invalid("INVALID_CONTRACT_VERSION_TYPE", "contract_version must be a string", raw);
  }

  if (parsed.contract_version !== SUPPORTED_ASSISTANT_RESPONSE_CONTRACT_VERSION) {
    return invalid("UNSUPPORTED_CONTRACT_VERSION", "Only Assistant Response Contract v1.0 is supported", raw);
  }

  if (!("reply" in parsed)) {
    return invalid("MISSING_REPLY", "reply is required", raw);
  }

  if (!("internal_boss_note" in parsed)) {
    return invalid("MISSING_INTERNAL_BOSS_NOTE", "internal_boss_note is required", raw);
  }

  if (typeof parsed.reply !== "string") {
    return invalid("INVALID_REPLY_TYPE", "reply must be a string", raw);
  }

  if (typeof parsed.internal_boss_note !== "string") {
    return invalid("INVALID_INTERNAL_BOSS_NOTE_TYPE", "internal_boss_note must be a string", raw);
  }

  const reply = parsed.reply.trim();
  if (reply === "") {
    return invalid("EMPTY_REPLY", "reply must not be empty", raw);
  }

  if (hasInternalNoteLeakRisk(reply)) {
    return invalid("INTERNAL_NOTE_LEAK_RISK", "reply appears to contain internal note content", raw);
  }

  if (reply.length > ASSISTANT_REPLY_MAX_LENGTH) {
    return invalid("REPLY_TOO_LONG", "reply exceeds max length", raw);
  }

  if (parsed.internal_boss_note.length > ASSISTANT_INTERNAL_NOTE_MAX_LENGTH) {
    return invalid("INTERNAL_NOTE_TOO_LONG", "internal_boss_note exceeds max length", raw);
  }

  return {
    ok: true,
    value: {
      contract_version: SUPPORTED_ASSISTANT_RESPONSE_CONTRACT_VERSION,
      reply,
      internal_boss_note: parsed.internal_boss_note
    }
  };
}
