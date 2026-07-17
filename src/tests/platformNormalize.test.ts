import { describe, it, expect } from "vitest";
import {
  sanitizeText,
  detectIntentsLight,
  buildNormalizedMessageDedupKey,
  parseManualJsonImport,
  parseManualCsvImport
} from "../connectors/normalizeLayer.js";

describe("Platform Normalize Layer", () => {
  describe("Sanitization", () => {
    it("masks full phone numbers", () => {
      const text = "Merhaba, numaram +90 555 123 45 67 ve +1234567890.";
      const sanitized = sanitizeText(text);
      expect(sanitized).toContain("****");
      expect(sanitized).not.toContain("555");
      expect(sanitized).not.toContain("555");
    });

    it("scrubs tokens, cookies, secrets, and api_keys", () => {
      const text = "Here is my token=abc123XYZ secret: hidden_val api_key: test-key";
      const sanitized = sanitizeText(text);
      expect(sanitized).toContain("token=***");
      expect(sanitized).toContain("secret=***");
      expect(sanitized).toContain("api_key=***");
      expect(sanitized).not.toContain("abc123XYZ");
      expect(sanitized).not.toContain("hidden_val");
      expect(sanitized).not.toContain("test-key");
    });

    it("scrubs internal_boss_note completely", () => {
      const text = "User asked for help. internal_boss_note: user seems confused, might need manual support.";
      const sanitized = sanitizeText(text);
      expect(sanitized).toContain("[REDACTED_INTERNAL_NOTE]");
      expect(sanitized).not.toContain("confused");
      expect(sanitized).not.toContain("internal_boss_note:");
    });

    it("scrubs URL query tokens", () => {
      const text = "Click here: https://example.com/login?token=super-secret&id=123";
      const sanitized = sanitizeText(text);
      expect(sanitized).toContain("?token=***&id=123");
      expect(sanitized).not.toContain("super-secret");
    });
  });

  describe("Intent Detection", () => {
    it("detects support signals", () => {
      expect(detectIntentsLight("Bana yardım eder misiniz?")).toContain("support_signal");
    });
    
    it("detects installation questions", () => {
      expect(detectIntentsLight("Uygulamayı nasıl kuracağım?")).toContain("installation_question");
    });

    it("detects payment or trust questions", () => {
      expect(detectIntentsLight("Maaş ne zaman yatar, bu bir scam mi?")).toEqual(expect.arrayContaining(["payment_or_trust_question"]));
    });

    it("falls back to unknown if no intents match", () => {
      expect(detectIntentsLight("Merhaba")).toEqual(["unknown"]);
    });
  });

  describe("Dedup Key Building", () => {
    it("generates stable deduplication key without raw ids", () => {
      const msg = {
        platform: "whatsapp",
        source_type: "private_chat",
        source_safe_ref: "SRC-111111",
        sender_safe_ref: "SND-222222",
        sender_role_hint: "candidate",
        message_text_sanitized: "Hello world",
        timestamp: "2026-07-06T12:34:56.789Z",
        direction: "inbound",
        attachments_meta_sanitized: [],
        detected_intents: ["unknown"],
        risk_flags: []
      } as any;

      const key1 = buildNormalizedMessageDedupKey(msg);
      const key2 = buildNormalizedMessageDedupKey(msg);
      
      expect(key1).toEqual(key2);
      expect(key1).toHaveLength(64); // sha256 hex length
    });

    it("absorbs minor clock drift using minute buckets", () => {
      const msg1 = {
        platform: "whatsapp",
        source_safe_ref: "SRC-1",
        sender_safe_ref: "SND-1",
        message_text_sanitized: "Hello",
        timestamp: "2026-07-06T12:34:10.000Z", // 12:34
      } as any;

      const msg2 = {
        platform: "whatsapp",
        source_safe_ref: "SRC-1",
        sender_safe_ref: "SND-1",
        message_text_sanitized: "Hello",
        timestamp: "2026-07-06T12:34:59.000Z", // still 12:34
      } as any;

      expect(buildNormalizedMessageDedupKey(msg1)).toEqual(buildNormalizedMessageDedupKey(msg2));
    });
  });

  describe("JSON Parser", () => {
    it("parses valid manual JSON array to normalized messages", () => {
      const json = JSON.stringify([
        {
          platform: "whatsapp",
          source_type: "private_chat",
          source_id: "905551234567@s.whatsapp.net",
          sender_id: "905551234567",
          message: "Hi, I need help. internal_boss_note: check this out",
          timestamp: "2026-07-06T10:00:00Z",
          direction: "inbound",
          campaign_id: "camp_123",
          source_label: "test_label"
        }
      ]);

      const msgs = parseManualJsonImport(json);
      expect(msgs).toHaveLength(1);
      const m = msgs[0];
      expect(m.platform).toBe("whatsapp");
      expect(m.source_type).toBe("private_chat");
      expect(m.message_text_sanitized).toBe("Hi, I need help. [REDACTED_INTERNAL_NOTE]");
      expect(m.direction).toBe("inbound");
      expect(m.sender_role_hint).toBe("candidate");
      
      // Raw IDs should not be in response
      expect((m as any).source_id).toBeUndefined();
      expect(m.source_safe_ref).toMatch(/^SRC-[A-F0-9]{6}$/);
      expect(m.sender_safe_ref).toMatch(/^SND-[A-F0-9]{6}$/);
      
      // External context
      expect(m.source_label_safe).toBe("test_label");
      expect(m.campaign_safe_ref).toBeDefined();
      expect(m.campaign_safe_ref).not.toBe("camp_123");
      expect(m.external_context_hash).toBeDefined();
    });

    it("rejects invalid/empty rows safely", () => {
      const json = JSON.stringify([
        { platform: "whatsapp", message: "" },
        { platform: "whatsapp" } // missing message
      ]);
      const msgs = parseManualJsonImport(json);
      expect(msgs).toHaveLength(0);
    });
  });

  describe("CSV Parser", () => {
    it("parses manual CSV import to normalized messages", () => {
      const csv = `platform, source_type, source_id, sender_id, message, timestamp, direction, campaign_id, source_label
whatsapp, group, 1234-5678@g.us, 905551112233, Hello group my token=secret123, 2026-07-06T10:00:00Z, inbound, cmp99, my_export`;
      
      const msgs = parseManualCsvImport(csv);
      expect(msgs).toHaveLength(1);
      const m = msgs[0];
      
      expect(m.platform).toBe("whatsapp");
      expect(m.source_type).toBe("group");
      expect(m.message_text_sanitized).toContain("token=***");
      expect(m.message_text_sanitized).not.toContain("secret123");
      expect(m.source_safe_ref).toMatch(/^SRC-[A-F0-9]{6}$/);
      expect(m.sender_safe_ref).toMatch(/^SND-[A-F0-9]{6}$/);
      expect(m.campaign_safe_ref).toBeDefined();
      expect(m.campaign_safe_ref).not.toBe("cmp99");
      expect(m.source_label_safe).toBe("my_export");
    });
  });
});
