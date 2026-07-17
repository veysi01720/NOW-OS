export function sanitizeMessageText(text: string): string {
  if (!text) return "";

  let sanitized = text;

  // Mask Secrets/Tokens
  sanitized = sanitized.replace(/\b(?:Bearer\s+)[a-zA-Z0-9-._~+/]+=*/gi, "Bearer [TOKEN_MASKED]");
  sanitized = sanitized.replace(/\b(?:sk-[a-zA-Z0-9_-]{20,})\b/gi, "[TOKEN_MASKED]");
  sanitized = sanitized.replace(/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/gi, "[TOKEN_MASKED]"); // JWT

  // Mask IBAN (TR followed by 24 digits, spaces allowed)
  sanitized = sanitized.replace(/\bTR\s*\d{2}\s*(?:\d\s*){22}\b/gi, "[IBAN_MASKED]");

  // Mask Cards (16 digits, spaces or dashes)
  sanitized = sanitized.replace(/\b(?:\d[ -]*?){13,16}\b/g, "[CARD_MASKED]");

  // Mask Phone numbers (very naive catch for 10-14 digit numbers with optional +)
  sanitized = sanitized.replace(/(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{3}\)?[\s-]?)?\d{3}[\s-]?\d{2}[\s-]?\d{2}/g, "[PHONE_MASKED]");

  // Mask URLs
  sanitized = sanitized.replace(/https?:\/\/[^\s]+/g, "[URL_MASKED]");

  // Normalize excessive whitespace
  sanitized = sanitized.replace(/\s+/g, " ").trim();

  // Max length
  if (sanitized.length > 2000) {
    sanitized = sanitized.slice(0, 2000) + "... [TRUNCATED]";
  }

  return sanitized;
}
