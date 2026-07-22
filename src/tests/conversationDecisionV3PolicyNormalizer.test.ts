import { describe, expect, it } from "vitest";
import {
  normalizeConversationDecisionV3MissingPolicy,
  MISSING_POLICY_NORMALIZATION_ID,
} from "../intelligence/conversation/ConversationDecisionV3PolicyNormalizer.js";
import type { ConversationDecisionV3 } from "../intelligence/conversation/ConversationDecisionV3Schema.js";
import {
  buildConversationDecisionV3SemanticContext,
  validateConversationDecisionV3Semantics,
} from "../intelligence/conversation/ConversationDecisionV3SemanticValidator.js";
import {
  buildResponsesGoldenAdapterInput,
  RESPONSES_COMBINED_SCENARIOS,
} from "../modelAdapter/responsesGoldenReplay.js";

function unknownAppInput() {
  const scenario = RESPONSES_COMBINED_SCENARIOS.find((item) => item.id === "p12_unknown_app_missing_info");
  if (!scenario) throw new Error("UNKNOWN_APP_FIXTURE_MISSING");
  const input = buildResponsesGoldenAdapterInput(scenario);
  input.metadata.featureFlags.responses_missing_policy_normalization_enabled = true;
  return input;
}

function decision(overrides: Partial<ConversationDecisionV3> = {}): ConversationDecisionV3 {
  return {
    decision_version: "3.1",
    intent: { primary: "app_fact_question", secondary: [], confidence: 0.9 },
    role: "candidate",
    direct_question: { present: true, question_summary: "app code", answered_in_reply: true },
    reply: {
      text: "Bu uygulama icin dogrulanmis bilgi yok. Ekip kontrol etsin.",
      language: "tr",
      tone: "natural_concise",
      contains_question: false,
    },
    next_action: "ask_missing_info",
    chosen_actions: ["clarify_ambiguous_input"],
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
    missing_fields: [],
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

describe("ConversationDecisionV3 missing-policy canonicalizer", () => {
  it("is byte-equivalent and inactive when the default-off flag is disabled", () => {
    const input = unknownAppInput();
    input.metadata.featureFlags.responses_missing_policy_normalization_enabled = false;
    const original = decision();
    const result = normalizeConversationDecisionV3MissingPolicy(original, input);

    expect(result.applied).toBe(false);
    expect(result.reason_codes).toEqual(["NORMALIZATION_DISABLED"]);
    expect(result.decision).toBe(original);
  });

  it("canonicalizes every mismatched control tuple to backend-allowed escalation", () => {
    const input = unknownAppInput();
    const result = normalizeConversationDecisionV3MissingPolicy(decision(), input);

    expect(input.metadata.inferredIntent).toBe("unknown_app_policy_missing");
    expect(result.applied).toBe(true);
    expect(result.normalization_id).toBe(MISSING_POLICY_NORMALIZATION_ID);
    expect(result.decision.chosen_actions).toEqual(["escalate_policy_missing"]);
    expect(result.decision.next_action).toBe("escalate_missing_info");
    expect(result.decision.requires_escalation).toBe(true);
    expect(result.decision.escalation_reason).toBe("missing_verified_app_policy_fact");
    expect(result.original_control_tuple_hash).not.toBe(result.normalized_control_tuple_hash);
  });

  it("is idempotent when the model tuple is already canonical", () => {
    const input = unknownAppInput();
    const canonical = decision({
      chosen_actions: ["escalate_policy_missing"],
      next_action: "escalate_missing_info",
      requires_escalation: true,
      escalation_reason: "missing_verified_app_policy_fact",
    });
    const result = normalizeConversationDecisionV3MissingPolicy(canonical, input);

    expect(result.applied).toBe(false);
    expect(result.normalization_id).toBe(MISSING_POLICY_NORMALIZATION_ID);
    expect(result.reason_codes).toEqual(["ALREADY_CANONICAL"]);
  });

  it("uses ask-selected-app, escalation, then clarification precedence", () => {
    const askInput = unknownAppInput();
    (askInput.contextPayload.conversation_decision_v2 as { allowed_actions: string[] }).allowed_actions = [
      "ask_selected_app",
      "escalate_policy_missing",
      "clarify_ambiguous_input",
    ];
    const ask = normalizeConversationDecisionV3MissingPolicy(decision(), askInput).decision;
    expect([ask.chosen_actions, ask.next_action, ask.requires_escalation]).toEqual([
      ["ask_selected_app"], "ask_missing_info", false,
    ]);

    const clarifyInput = unknownAppInput();
    (clarifyInput.contextPayload.conversation_decision_v2 as { allowed_actions: string[] }).allowed_actions = [
      "clarify_ambiguous_input",
    ];
    const clarify = normalizeConversationDecisionV3MissingPolicy(decision(), clarifyInput).decision;
    expect([clarify.chosen_actions, clarify.next_action, clarify.requires_escalation]).toEqual([
      ["clarify_ambiguous_input"], "reply_only", false,
    ]);
  });

  it("does not invent an action when no safe action is allowed", () => {
    const input = unknownAppInput();
    (input.contextPayload.conversation_decision_v2 as { allowed_actions: string[] }).allowed_actions = ["answer_user_question"];
    const original = decision();
    const result = normalizeConversationDecisionV3MissingPolicy(original, input);

    expect(result.applied).toBe(false);
    expect(result.reason_codes).toEqual(["NO_SAFE_ALLOWED_ACTION"]);
    expect(result.decision).toBe(original);
  });

  it("leaves unsafe reply and unsupported state patch visible to semantic validation", () => {
    const input = unknownAppInput();
    const unsafe = decision({
      reply: { ...decision().reply, text: "NovaChat kodu kesin budur." },
      state_patch: { ...decision().state_patch, daily_hours: 8 },
    });
    const normalized = normalizeConversationDecisionV3MissingPolicy(unsafe, input).decision;
    const validation = validateConversationDecisionV3Semantics(
      normalized,
      buildConversationDecisionV3SemanticContext(input),
    );

    expect(normalized.reply.text).toBe(unsafe.reply.text);
    expect(normalized.state_patch.daily_hours).toBe(8);
    expect(validation.ok).toBe(false);
    expect(validation.reason_codes).toContain("UNAPPROVED_APP_IN_REPLY");
    expect(validation.reason_codes).toContain("STATE_PATCH_EVIDENCE_MISSING");
  });

  it.each([
    ["owner role", () => { const input = unknownAppInput(); input.senderRole = "owner"; return input; }, "ROLE_NOT_CANDIDATE"],
    ["group channel", () => { const input = unknownAppInput(); input.channelType = "group"; return input; }, "CHANNEL_NOT_PRIVATE"],
    ["approved app", () => { const input = unknownAppInput(); input.contextPayload.allowed_apps.push("NovaChat"); return input; }, "UNAPPROVED_APP_TERM_NOT_FOUND"],
  ])("does not normalize %s", (_label, buildInput, expectedReason) => {
    const original = decision();
    const result = normalizeConversationDecisionV3MissingPolicy(original, buildInput());

    expect(result.applied).toBe(false);
    expect(result.reason_codes).toEqual([expectedReason]);
    expect(result.decision).toBe(original);
  });

  it("canonicalizes missing payment policy and replaces unsafe guarantee wording", () => {
    const input = unknownAppInput();
    input.metadata.inferredIntent = "payment_and_trust_objection";
    const original = decision({
      next_action: "escalate_missing_info",
      chosen_actions: ["escalate_policy_missing"],
      requires_escalation: true,
      escalation_reason: "missing_verified_app_policy_fact",
      reply: { ...decision().reply, text: "Kesin kazanirim, hic risk yok." },
    });

    const result = normalizeConversationDecisionV3MissingPolicy(original, input);

    expect(result.applied).toBe(true);
    expect(result.reason_codes).toContain("UNSAFE_PAYMENT_TRUST_REPLY_REPLACED");
    expect(result.decision.next_action).toBe("escalate_missing_info");
    expect(result.decision.chosen_actions).toEqual(["escalate_policy_missing"]);
    expect(result.decision.reply.text).toContain("dogrulanmis");
    expect(result.decision.reply.text).not.toContain("hic risk yok");
  });
});
