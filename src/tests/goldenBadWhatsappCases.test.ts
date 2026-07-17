import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface GoldenBadWhatsappCase {
  scenario_id: string;
  role: string;
  state: string;
  user_message_masked: string;
  bad_bot_reply_masked: string;
  expected_good_reply: string;
  why_bad: string;
  expected_intent: string;
  expected_next_action: string;
  missing_fields: string[];
  forbidden_reply_patterns: string[];
  should_send_whatsapp_reply: boolean;
}

function loadCases(): GoldenBadWhatsappCase[] {
  return JSON.parse(
    readFileSync(join(process.cwd(), "src/tests/fixtures/golden-bad-whatsapp-cases.json"), "utf8"),
  ) as GoldenBadWhatsappCase[];
}

describe("golden bad WhatsApp fixture format", () => {
  it("captures sanitized real-failure categories for future Responses replay", () => {
    const cases = loadCases();
    const scenarioIds = new Set(cases.map((item) => item.scenario_id));
    const serialized = JSON.stringify(cases);

    expect(cases.length).toBeGreaterThanOrEqual(5);
    expect(scenarioIds.size).toBe(cases.length);
    for (const requiredId of [
      "bad_wp_first_contact_repeated_intake",
      "bad_wp_unsupported_reference_owner_advice",
      "bad_wp_candidate_facing_reference_offer",
      "bad_wp_repeated_owner_address",
      "bad_wp_text_only_unnecessary_restatement",
    ]) {
      expect(scenarioIds.has(requiredId)).toBe(true);
    }
    expect(serialized).not.toMatch(/\b\d{10,15}\b/);
    expect(serialized).not.toContain("@s.whatsapp.net");
    expect(serialized).not.toContain("@g.us");
    expect(serialized).not.toMatch(/\bsk-[A-Za-z0-9_-]+\b/);
    expect(serialized).not.toMatch(/api[_-]?key|token|secret/i);
  });

  it("uses the master-plan fixture contract fields for every case", () => {
    for (const item of loadCases()) {
      expect(item.scenario_id).toMatch(/^bad_wp_/);
      expect(item.role).not.toBe("");
      expect(item.state).not.toBe("");
      expect(item.user_message_masked).not.toBe("");
      expect(item.bad_bot_reply_masked).not.toBe("");
      expect(item.expected_good_reply).not.toBe("");
      expect(item.why_bad).not.toBe("");
      expect(item.expected_intent).not.toBe("");
      expect(item.expected_next_action).not.toBe("");
      expect(Array.isArray(item.missing_fields)).toBe(true);
      expect(Array.isArray(item.forbidden_reply_patterns)).toBe(true);
      expect(item.forbidden_reply_patterns.length).toBeGreaterThan(0);
      expect(typeof item.should_send_whatsapp_reply).toBe("boolean");
    }
  });
});
