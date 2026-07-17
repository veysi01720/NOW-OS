/**
 * redaction.ts
 * Implements strict scrubbing of PII, raw identifiers, and secrets from strings and objects.
 */

const SENSITIVE_KEYS = [
  "token",
  "key",
  "secret",
  "password",
  "auth",
  "remotejid",
  "phone",
  "openai",
  "internal_boss_note",
  "messageid",
  "message_id",
  "groupid",
  "group_id"
];

const PHONE_PATTERN = /\+?\d{10,15}/g;
const REMOTE_JID_PATTERN = /\d{10,15}@s\.whatsapp\.net/g;
const GROUP_JID_PATTERN = /\d{10,30}(-\d+)?@g\.us/g;
const OPENAI_ID_PATTERN = /(?:msg|thread|run|asst)_[a-zA-Z0-9]{20,}/g;
const OPENAI_KEY_PATTERN = /sk-[a-zA-Z0-9-]{20,}/g;

/**
 * Replaces sensitive patterns in a string with a redacted marker.
 */
export function redactSecrets(input: string): string {
  if (!input) return input;
  let redacted = input;
  
  redacted = redacted.replace(OPENAI_KEY_PATTERN, "[REDACTED_TOKEN]");
  redacted = redacted.replace(REMOTE_JID_PATTERN, "[REDACTED_JID]");
  redacted = redacted.replace(GROUP_JID_PATTERN, "[REDACTED_GROUP_JID]");
  redacted = redacted.replace(PHONE_PATTERN, "[REDACTED_PHONE]");
  redacted = redacted.replace(OPENAI_ID_PATTERN, "[REDACTED_ID]");
  
  return redacted;
}

/**
 * Deep clones and sanitizes an object by masking values of sensitive keys
 * and scrubbing sensitive patterns from all string values.
 */
export function sanitizeLogObject(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return redactSecrets(obj);
  if (typeof obj !== "object") return obj;
  
  if (Array.isArray(obj)) {
    return obj.map(sanitizeLogObject);
  }

  const sanitized: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    const lowerKey = k.toLowerCase();
    const isSensitive = SENSITIVE_KEYS.some(sk => lowerKey.includes(sk));
    
    if (isSensitive && v) {
      sanitized[k] = "***";
    } else {
      sanitized[k] = sanitizeLogObject(v);
    }
  }
  return sanitized;
}

export function assertNoSensitiveLeak(input: string): boolean {
  if (!input) return true;
  if (PHONE_PATTERN.test(input)) return false;
  if (REMOTE_JID_PATTERN.test(input)) return false;
  if (GROUP_JID_PATTERN.test(input)) return false;
  if (OPENAI_ID_PATTERN.test(input)) return false;
  if (OPENAI_KEY_PATTERN.test(input)) return false;
  return true;
}
