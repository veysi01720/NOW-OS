import { describe, expect, it } from "vitest";
import { validateAndApplyStatePatch } from "../intelligence/candidate/StatePatchValidator.js";
import type { ConversationDecision, ConversationDecisionContext } from "../intelligence/conversation/ConversationDecisionSchema.js";
import { defaultUserState } from "../storage/types.js";

function context(capturedFields: string[], text = "27 erkek 4 saat"): ConversationDecisionContext {
  return {
    latest_message: { text },
    facts_extracted_from_current_message: capturedFields,
  } as ConversationDecisionContext;
}

function decision(statePatch: ConversationDecision["state_patch"]): ConversationDecision {
  return { state_patch: statePatch } as ConversationDecision;
}

describe("StatePatchValidator", () => {
  it("ignores null preference placeholders from the V3 mapper", () => {
    const result = validateAndApplyStatePatch(
      defaultUserState(),
      decision({ preferred_work_mode: null, video_allowed: null }),
      context([]),
      ["Layla"],
    );

    expect(result.ok).toBe(true);
    expect(result.reason_codes).toEqual([]);
  });

  it("accepts only an idempotent intake echo captured from the current message", () => {
    const current = {
      ...defaultUserState(),
      age: 27,
      gender: "erkek",
      daily_hours: 4,
    };
    const result = validateAndApplyStatePatch(
      current,
      decision({ age: 27, gender: "erkek", daily_hours: 4 }),
      context(["age", "gender", "daily_hours"]),
      ["Layla"],
    );

    expect(result.ok).toBe(true);
    expect(result.reason_codes).toEqual([]);
  });

  it("keeps uncaptured or conflicting intake changes fail-closed", () => {
    const current = {
      ...defaultUserState(),
      age: 27,
      gender: "erkek",
      daily_hours: 4,
    };
    const result = validateAndApplyStatePatch(
      current,
      decision({ age: 27, gender: "kadın" }),
      context(["age"]),
      ["Layla"],
    );

    expect(result.ok).toBe(false);
    expect(result.reason_codes).toContain("AUTHORITATIVE_INTAKE_PATCH_NOT_ALLOWED_FROM_DECISION");
  });

  it("does not infer app, phone, or acceptance state from a message that does not say it", () => {
    const current = {
      ...defaultUserState(),
      work_model_disclosed: true,
    };
    const directQuestion = context([], "Erkek hesabi mi acacagim?");

    const app = validateAndApplyStatePatch(current, decision({ selected_app: "Layla" }), directQuestion, ["Layla"]);
    const phone = validateAndApplyStatePatch(current, decision({ phone_type: "android" }), directQuestion, ["Layla"]);
    const acceptance = validateAndApplyStatePatch(current, decision({ work_model_acceptance: "accepted" }), directQuestion, ["Layla"]);

    expect(app.reason_codes).toContain("STATE_PATCH_SELECTED_APP_WITHOUT_EVIDENCE");
    expect(phone.reason_codes).toContain("STATE_PATCH_PHONE_TYPE_WITHOUT_EVIDENCE");
    expect(acceptance.reason_codes).toContain("STATE_PATCH_ACCEPTANCE_WITHOUT_EVIDENCE");
  });
});
