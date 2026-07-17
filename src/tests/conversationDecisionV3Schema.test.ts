import { describe, expect, it } from "vitest";
import {
  CONVERSATION_DECISION_V3_SCHEMA,
  CONVERSATION_DECISION_V3_SCHEMA_VERSION,
  validateConversationDecisionV3Shape,
} from "../intelligence/conversation/ConversationDecisionV3Schema.js";

function validDecision(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    decision_version: CONVERSATION_DECISION_V3_SCHEMA_VERSION,
    intent: { primary: "candidate_first_contact", secondary: [], confidence: 0.91 },
    role: "candidate",
    direct_question: { present: false, question_summary: null, answered_in_reply: true },
    reply: {
      text: "Merhaba, ilerleyebilmem için yaşını, cinsiyetini ve günlük kaç saat ayırabileceğini yazar mısın?",
      language: "tr",
      tone: "natural_concise",
      contains_question: true,
    },
    next_action: "ask_missing_info",
    chosen_actions: ["ask_missing_age", "ask_missing_gender", "ask_missing_daily_hours"],
    state_patch: {
      age: null,
      gender: null,
      daily_hours: null,
      work_model_acceptance: null,
      selected_app: null,
      phone_type: null,
      work_model_disclosed: null,
      preferred_work_mode: null,
      video_allowed: null,
    },
    state_patch_evidence: [],
    missing_fields: ["age", "gender", "daily_hours"],
    policy_facts_used: [],
    requires_escalation: false,
    escalation_reason: null,
    risk_flags: [],
    quality_signals: {
      answered_latest_message: true,
      used_relevant_state: true,
      did_not_repeat_known_info: true,
      asked_only_one_clear_question: true,
      reply_is_natural_turkish: true,
      no_generic_closer: true,
      no_invented_policy: true,
      correct_role_boundary: true,
    },
    self_check: {
      answered_latest_message: true,
      asked_known_information_again: false,
      invented_policy: false,
      offered_setup_too_early: false,
      used_generic_closing: false,
    },
    ...overrides,
  };
}

describe("ConversationDecisionV3 strict schema", () => {
  it("accepts a complete strict V3 decision", () => {
    expect(validateConversationDecisionV3Shape(validDecision())).toEqual({ ok: true, reason_codes: [] });
  });

  it("rejects missing required fields", () => {
    const decision = validDecision();
    delete decision.reply;

    const result = validateConversationDecisionV3Shape(decision);

    expect(result.ok).toBe(false);
    expect(result.reason_codes).toContain("MISSING_REQUIRED:$.reply");
  });

  it("rejects top-level and nested additional properties", () => {
    const decision = validDecision({
      contract_version: "1.0",
      reply: {
        text: "Merhaba",
        language: "tr",
        tone: "natural_concise",
        contains_question: false,
        internal_boss_note: "not allowed",
      },
    });

    const result = validateConversationDecisionV3Shape(decision);

    expect(result.ok).toBe(false);
    expect(result.reason_codes).toEqual(
      expect.arrayContaining([
        "ADDITIONAL_PROPERTY:$.contract_version",
        "ADDITIONAL_PROPERTY:$.reply.internal_boss_note",
      ]),
    );
  });

  it("rejects empty public reply text and invalid enum values", () => {
    const decision = validDecision({
      role: "admin",
      reply: { text: " ", language: "tr", tone: "robotic", contains_question: false },
    });

    const result = validateConversationDecisionV3Shape(decision);

    expect(result.ok).toBe(false);
    expect(result.reason_codes).toEqual(
      expect.arrayContaining(["ENUM_MISMATCH:$.role", "MIN_LENGTH:$.reply.text", "ENUM_MISMATCH:$.reply.tone"]),
    );
  });

  it("rejects chosen actions outside the backend domain catalog", () => {
    const result = validateConversationDecisionV3Shape(validDecision({
      chosen_actions: ["reply_only"],
    }));

    expect(result.ok).toBe(false);
    expect(result.reason_codes).toContain("ENUM_MISMATCH:$.chosen_actions[0]");
  });

  it("requires completed text-only patch fields and evidence collection", () => {
    const statePatch = { ...(validDecision().state_patch as Record<string, unknown>) };
    delete statePatch.preferred_work_mode;
    delete statePatch.video_allowed;
    const decision = validDecision({ state_patch: statePatch });
    delete decision.state_patch_evidence;

    const result = validateConversationDecisionV3Shape(decision);

    expect(result.reason_codes).toEqual(expect.arrayContaining([
      "MISSING_REQUIRED:$.state_patch.preferred_work_mode",
      "MISSING_REQUIRED:$.state_patch.video_allowed",
      "MISSING_REQUIRED:$.state_patch_evidence",
    ]));
  });

  it("accepts a text-only preference patch with sanitized structured evidence", () => {
    const result = validateConversationDecisionV3Shape(validDecision({
      next_action: "update_candidate_state",
      chosen_actions: ["acknowledge_information", "record_work_preference"],
      state_patch: {
        ...(validDecision().state_patch as Record<string, unknown>),
        preferred_work_mode: "text_only",
        video_allowed: false,
      },
      state_patch_evidence: [
        { field: "preferred_work_mode", source: "current_message", evidence_ref: null },
        { field: "video_allowed", source: "current_message", evidence_ref: null },
      ],
    }));

    expect(result).toEqual({ ok: true, reason_codes: [] });
  });

  it("rejects unknown evidence fields, sources, and raw-text properties", () => {
    const result = validateConversationDecisionV3Shape(validDecision({
      state_patch_evidence: [{
        field: "unknown_field",
        source: "raw_user_text",
        evidence_ref: null,
        raw_text: "not allowed",
      }],
    }));

    expect(result.reason_codes).toEqual(expect.arrayContaining([
      "ENUM_MISMATCH:$.state_patch_evidence[0].field",
      "ENUM_MISMATCH:$.state_patch_evidence[0].source",
      "ADDITIONAL_PROPERTY:$.state_patch_evidence[0].raw_text",
    ]));
  });

  it("declares additionalProperties false for every schema object", () => {
    const missing: string[] = [];

    function walk(schema: Record<string, unknown>, path: string): void {
      if (schema.type === "object" && schema.additionalProperties !== false) {
        missing.push(path);
      }
      const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
      if (properties !== undefined) {
        for (const [key, child] of Object.entries(properties)) walk(child, `${path}.${key}`);
      }
      const anyOf = schema.anyOf as Array<Record<string, unknown>> | undefined;
      anyOf?.forEach((child, index) => walk(child, `${path}.anyOf[${index}]`));
      const items = schema.items as Record<string, unknown> | undefined;
      if (items !== undefined) walk(items, `${path}.items`);
    }

    walk(CONVERSATION_DECISION_V3_SCHEMA, "$");

    expect(missing).toEqual([]);
  });
});
