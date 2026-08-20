import { describe, expect, it } from "vitest";
import { validateAndApplyStatePatch } from "../intelligence/candidate/StatePatchValidator.js";
import type { ConversationDecision, ConversationDecisionContext } from "../intelligence/conversation/ConversationDecisionSchema.js";
import { defaultUserState } from "../storage/types.js";

function context(capturedFields: string[], text = "27 erkek 4 saat"): ConversationDecisionContext {
  return {
    role: "candidate",
    channel: "private",
    latest_message: { text },
    facts_extracted_from_current_message: capturedFields,
  } as ConversationDecisionContext;
}

function decision(
  statePatch: ConversationDecision["state_patch"],
  evidence: NonNullable<ConversationDecision["state_patch_evidence"]> = [],
): ConversationDecision {
  return { state_patch: statePatch, state_patch_evidence: evidence } as ConversationDecision;
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

  it("accepts and applies a private candidate correction proven by the latest message", () => {
    const current = {
      ...defaultUserState(),
      age: 27,
      gender: "erkek",
      daily_hours: 4,
      eligibility_status: "eligible" as const,
      work_model_disclosed: true,
    };
    const result = validateAndApplyStatePatch(
      current,
      decision(
        { age: 29, gender: "kadın", daily_hours: 6 },
        [
          { field: "age", source: "current_message", evidence_ref: null },
          { field: "gender", source: "current_message", evidence_ref: null },
          { field: "daily_hours", source: "current_message", evidence_ref: null },
        ],
      ),
      context([], "Yanlış vermişim, 29 kadın 6 saat"),
      ["Layla"],
    );

    expect(result.ok).toBe(true);
    expect(result.reason_codes).toEqual([]);
    expect(result.state).toMatchObject({ age: 29, gender: "kadın", daily_hours: 6, eligibility_status: "eligible" });
  });

  it("keeps privileged and unsupported intake corrections fail-closed", () => {
    const current = { ...defaultUserState(), age: 27, gender: "erkek", daily_hours: 4 };
    const correction = decision(
      { age: 29, gender: "kadın" },
      [
        { field: "age", source: "current_message", evidence_ref: null },
        { field: "gender", source: "current_message", evidence_ref: null },
      ],
    );
    const ownerContext = { ...context([], "Yanlış vermişim, 29 kadın"), role: "owner" };
    const unsupported = decision(
      { age: 29, gender: "kadın" },
      [{ field: "age", source: "current_message", evidence_ref: null }],
    );

    const ownerResult = validateAndApplyStatePatch(current, correction, ownerContext, ["Layla"]);
    const unsupportedResult = validateAndApplyStatePatch(
      current,
      unsupported,
      context([], "Yanlış vermişim, 29 kadın"),
      ["Layla"],
    );

    expect(ownerResult.ok).toBe(false);
    expect(ownerResult.state).toMatchObject({ age: 27, gender: "erkek", daily_hours: 4 });
    expect(unsupportedResult.ok).toBe(false);
    expect(unsupportedResult.state).toMatchObject({ age: 27, gender: "erkek", daily_hours: 4 });
    expect(ownerResult.reason_codes).toContain("AUTHORITATIVE_INTAKE_PATCH_NOT_ALLOWED_FROM_DECISION");
    expect(unsupportedResult.reason_codes).toContain("AUTHORITATIVE_INTAKE_PATCH_NOT_ALLOWED_FROM_DECISION");
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
