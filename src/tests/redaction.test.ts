import { redactSecrets, sanitizeLogObject } from "../utils/redaction.js";
import { describe, it, expect } from "vitest";

describe("Redaction Tests", () => {
  it("redacts Evolution 400 error containing remoteJid", () => {
    const err1 = "Evolution sendText failed with 400: {\"status\":400,\"error\":\"Bad Request\",\"response\":{\"message\":[{\"jid\":\"905321234567@s.whatsapp.net\",\"exists\":false,\"number\":\"905321234567\"}]}}";
    const redacted1 = redactSecrets(err1);
    expect(redacted1.includes("905321234567@s.whatsapp.net")).toBe(false);
    expect(redacted1.includes("[REDACTED_JID]")).toBe(true);
    expect(redacted1.includes("\"number\":\"[REDACTED_PHONE]\"")).toBe(true);
  });

  it("redacts provider error body containing token", () => {
    const obj = {
      error: "Unauthorized",
      token: "sk-proj-1234567890abcdef1234567890abcdef",
      remoteJid: "905321234567@s.whatsapp.net"
    };
    const sanitizedObj = sanitizeLogObject(obj);
    expect(sanitizedObj.token).toBe("***");
    expect(sanitizedObj.remoteJid).toBe("***");
  });
  
  it("redacts OpenAI API Error string", () => {
    const err2 = "OpenAI error: Invalid API key sk-proj-1234567890abcdef1234567890abcdef";
    const redacted2 = redactSecrets(err2); console.log('ACTUAL:', redacted2);
    expect(redacted2.includes("sk-proj-")).toBe(false);
    expect(redacted2.includes("[REDACTED_TOKEN]")).toBe(true);
  });
});
