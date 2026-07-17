import { describe, expect, it } from "vitest";
import { sanitizeSummary } from "../behavior/conversationStateService.js";

describe("behavior summary sanitizer", () => {
  it("masks raw phone and jid values", () => {
    const sanitized = sanitizeSummary(
      "Kullanici 905333333333 ve 905333333333@s.whatsapp.net ile yazisti. Grup 1234567890@g.us.",
    );

    expect(sanitized).not.toContain("905333333333");
    expect(sanitized).not.toContain("@s.whatsapp.net");
    expect(sanitized).not.toContain("1234567890@g.us");
    expect(sanitized).toContain("[masked_phone]");
  });

  it("removes secret-like values and internal notes", () => {
    const sanitized = sanitizeSummary(
      "api_key=super-secret token:abc123 sk-testsecret internal_boss_note system prompt",
    );

    expect(sanitized).not.toContain("super-secret");
    expect(sanitized).not.toContain("abc123");
    expect(sanitized).not.toContain("sk-testsecret");
    expect(sanitized).not.toContain("internal_boss_note");
    expect(sanitized).not.toContain("system prompt");
  });

  it("truncates long copied summaries", () => {
    expect(sanitizeSummary("uzun ".repeat(500)).length).toBeLessThanOrEqual(700);
  });
});
