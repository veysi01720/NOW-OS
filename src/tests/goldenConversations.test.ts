import { describe, expect, it } from "vitest";
import {
  GOLDEN_CONVERSATION_FIXTURES,
  GOLDEN_EVALUATION_CRITERIA,
  runGoldenConversationEvaluation,
} from "../behavior/goldenConversations.js";

describe("behavior golden conversations", () => {
  it("defines sanitized fixtures across required scenario categories", () => {
    const categories = new Set(GOLDEN_CONVERSATION_FIXTURES.map((fixture) => fixture.category));
    const serialized = JSON.stringify(GOLDEN_CONVERSATION_FIXTURES);
    const requiredCategories = [
      "short_direct_question",
      "messaging_only",
      "trust_objection",
      "installation_stuck",
      "downloaded_next_step",
      "profile_photo_done",
      "payment_or_withdrawal",
      "previous_application",
      "repeated_question",
      "very_short_message",
      "confused_location",
      "angry_user",
      "human_support_request",
      "unknown_knowledge",
      "conflicting_knowledge",
      "owner_internal_instruction",
      "owner_spoof",
      "group_prefixless",
      "unauthorized_group_command",
      "wrong_tenant",
      "internal_note_leak",
      "excessive_length",
      "unnecessary_greeting",
      "known_iphone_preference",
      "known_messaging_preference",
      "completed_install_step",
      "low_confidence_escalation",
      "avoid_unnecessary_repeat",
    ];

    expect(GOLDEN_CONVERSATION_FIXTURES.length).toBeGreaterThanOrEqual(30);
    expect(categories.size).toBeGreaterThanOrEqual(28);
    for (const category of requiredCategories) {
      expect(categories.has(category as never)).toBe(true);
    }
    expect(serialized).not.toMatch(/\b\d{10,15}\b/);
    expect(serialized).not.toContain("@s.whatsapp.net");
    expect(serialized).not.toContain("@g.us");
    expect(serialized).not.toMatch(/\bsk-[A-Za-z0-9_-]+\b/);
    expect(serialized).not.toMatch(/api[_-]?key|token|secret/i);
  });

  it("runs legacy vs behavior evaluation and detects behavior improvement", () => {
    const result = runGoldenConversationEvaluation();

    expect(result.fixture_count).toBeGreaterThanOrEqual(30);
    expect(result.criteria_count).toBe(GOLDEN_EVALUATION_CRITERIA.length);
    expect(result.behavior_average_score).toBeGreaterThan(result.legacy_average_score);
    expect(result.improvement_detected).toBe(true);
    expect(result.repetition_reduced).toBe(true);
    expect(result.excessive_length_reduced).toBe(true);
    expect(result.context_usage_improved).toBe(true);
    expect(result.natural_whatsapp_tone_improved).toBe(true);
  });

  it("keeps mandatory safety gates green", () => {
    const result = runGoldenConversationEvaluation();

    expect(result.hallucination_absent).toBe(true);
    expect(result.internal_leak_absent).toBe(true);
    expect(result.group_policy_preserved).toBe(true);
    expect(result.unauthorized_command_blocked).toBe(true);
    expect(result.results.every((item) => item.behavior.safe_trust_wording)).toBe(true);
    expect(result.results.every((item) => item.behavior.state_transition_valid)).toBe(true);
  });
});
