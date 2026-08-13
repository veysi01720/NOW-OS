import { describe, expect, it } from "vitest";
import {
  CONVERSATION_DECISION_V3_SCHEMA_VERSION,
  type ConversationDecisionV3,
  type ConversationDecisionV3Action,
  type ConversationDecisionV3StatePatchField,
} from "../intelligence/conversation/ConversationDecisionV3Schema.js";
import {
  validateConversationDecisionV3Semantics,
  type ConversationDecisionV3SemanticContext,
} from "../intelligence/conversation/ConversationDecisionV3SemanticValidator.js";
import { defaultUserState } from "../storage/types.js";
import { LAYER_1_REASON_CODES, LAYER_2_REASON_CODES, classifyValidatorReasonCode } from "../intelligence/conversation/ConversationValidatorReasonCatalog.js";

function context(input: Partial<ConversationDecisionV3SemanticContext> = {}): ConversationDecisionV3SemanticContext {
  return {
    role: "candidate",
    channel_type: "private",
    latest_message: "27 erkek 4 saat",
    candidate_state: defaultUserState(),
    allowed_apps: ["Layla"],
    allowed_actions: ["acknowledge_information", "answer_user_question"],
    canonical_policy_fact_ids: ["work_fact"],
    ...input,
  };
}

function decision(input: {
  role?: ConversationDecisionV3["role"];
  reply?: string;
  next_action?: ConversationDecisionV3["next_action"];
  chosen_actions?: ConversationDecisionV3Action[];
  patch?: Partial<ConversationDecisionV3["state_patch"]>;
  evidence?: ConversationDecisionV3["state_patch_evidence"];
  policy_facts_used?: string[];
  requires_escalation?: boolean;
} = {}): ConversationDecisionV3 {
  const patch: ConversationDecisionV3["state_patch"] = {
    age: null,
    gender: null,
    daily_hours: null,
    work_model_acceptance: null,
    selected_app: null,
    phone_type: null,
    work_model_disclosed: null,
    preferred_work_mode: null,
    video_allowed: null,
    ...input.patch,
  };
  const evidence = input.evidence ?? Object.entries(patch)
    .filter(([, value]) => value !== null)
    .map(([field]) => ({
      field: field as ConversationDecisionV3StatePatchField,
      source: "current_message" as const,
      evidence_ref: null,
    }));

  return {
    decision_version: CONVERSATION_DECISION_V3_SCHEMA_VERSION,
    intent: { primary: "fixture", secondary: [], confidence: 0.9 },
    role: input.role ?? "candidate",
    direct_question: { present: false, question_summary: null, answered_in_reply: true },
    reply: { text: input.reply ?? "Bilgilerini aldim.", language: "tr", tone: "natural_concise", contains_question: false },
    next_action: input.next_action ?? "reply_only",
    chosen_actions: input.chosen_actions ?? ["answer_user_question"],
    state_patch: patch,
    state_patch_evidence: evidence,
    missing_fields: [],
    policy_facts_used: input.policy_facts_used ?? [],
    requires_escalation: input.requires_escalation ?? false,
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
  };
}

function expectRejected(result: ReturnType<typeof validateConversationDecisionV3Semantics>, code: string): void {
  expect(result.ok).toBe(false);
  expect(result.reason_codes).toContain(code);
}

describe("ConversationDecisionV3 semantic validator", () => {
  it("accepts a candidate intake patch only when current message evidence matches", () => {
    const result = validateConversationDecisionV3Semantics(decision({
      next_action: "update_candidate_state",
      chosen_actions: ["acknowledge_information"],
      patch: { age: 27, gender: "erkek", daily_hours: 4 },
    }), context());

    expect(result).toMatchObject({ ok: true, shape_valid: true, reason_codes: [] });
  });

  it("rejects actions outside the backend allowlist and incompatible orchestration actions", () => {
    expectRejected(validateConversationDecisionV3Semantics(decision({
      chosen_actions: ["ask_selected_app"],
    }), context({ allowed_actions: ["answer_user_question"] })), "CHOSEN_ACTION_NOT_ALLOWED");

    expectRejected(validateConversationDecisionV3Semantics(decision({
      next_action: "ask_missing_info",
      chosen_actions: ["answer_user_question"],
    }), context({ allowed_actions: ["answer_user_question"] })), "NEXT_ACTION_MISSING_INFO_INCOMPATIBLE");
  });

  it("accepts explain_work_model as a direct answer action for grounded work questions", () => {
    const result = validateConversationDecisionV3Semantics(decision({
      next_action: "answer_direct_question",
      chosen_actions: ["explain_work_model"],
    }), context({ allowed_actions: ["explain_work_model"] }));

    expect(result.ok).toBe(true);
  });

  it("accepts only grounded explicit missing-info escalation without state mutation", () => {
    const valid = validateConversationDecisionV3Semantics(decision({
      next_action: "escalate_missing_info",
      chosen_actions: ["escalate_policy_missing"],
      requires_escalation: true,
    }), context({ allowed_actions: ["escalate_policy_missing"] }));
    expect(valid.ok).toBe(true);

    expectRejected(validateConversationDecisionV3Semantics(decision({
      next_action: "escalate_missing_info",
      chosen_actions: ["answer_user_question"],
      requires_escalation: false,
    }), context({ allowed_actions: ["answer_user_question"] })), "NEXT_ACTION_MISSING_INFO_ESCALATION_INCOMPATIBLE");

    expectRejected(validateConversationDecisionV3Semantics(decision({
      next_action: "escalate_missing_info",
      chosen_actions: ["escalate_policy_missing"],
      requires_escalation: true,
      patch: { age: 27 },
    }), context({ allowed_actions: ["escalate_policy_missing"] })), "NEXT_ACTION_MISSING_INFO_ESCALATION_INCOMPATIBLE");
  });

  it("rejects missing, duplicate, orphan, and mismatched state patch evidence", () => {
    const missing = validateConversationDecisionV3Semantics(decision({
      next_action: "update_candidate_state",
      chosen_actions: ["acknowledge_information"],
      patch: { age: 27 },
      evidence: [],
    }), context());
    expectRejected(missing, "STATE_PATCH_EVIDENCE_MISSING");

    const duplicate = validateConversationDecisionV3Semantics(decision({
      next_action: "update_candidate_state",
      chosen_actions: ["acknowledge_information"],
      patch: { age: 27 },
      evidence: [
        { field: "age", source: "current_message", evidence_ref: null },
        { field: "age", source: "current_message", evidence_ref: null },
      ],
    }), context());
    expectRejected(duplicate, "STATE_PATCH_EVIDENCE_DUPLICATE");

    const orphan = validateConversationDecisionV3Semantics(decision({
      next_action: "reply_only",
      evidence: [{ field: "age", source: "current_message", evidence_ref: null }],
    }), context());
    expectRejected(orphan, "STATE_PATCH_EVIDENCE_ORPHAN");

    const mismatch = validateConversationDecisionV3Semantics(decision({
      next_action: "update_candidate_state",
      chosen_actions: ["acknowledge_information"],
      patch: { age: 28 },
    }), context());
    expectRejected(mismatch, "STATE_PATCH_CURRENT_MESSAGE_EVIDENCE_MISMATCH");
  });

  it("enforces approved app state patches and deterministic unapproved app vocabulary in replies", () => {
    expectRejected(validateConversationDecisionV3Semantics(decision({
      next_action: "update_candidate_state",
      chosen_actions: ["acknowledge_information"],
      patch: { selected_app: "TikTok" },
    }), context({ latest_message: "TikTok secmek istiyorum" })), "STATE_PATCH_APP_NOT_APPROVED");

    expectRejected(validateConversationDecisionV3Semantics(decision({
      reply: "TikTok uzerinden ilerleyebilirsin.",
    }), context()), "UNAPPROVED_APP_IN_REPLY");

    const approved = validateConversationDecisionV3Semantics(decision({
      reply: "TikTok uzerinden ilerleyebilirsin.",
    }), context({ allowed_apps: ["TikTok"], allowed_actions: ["answer_user_question"] }));
    expect(approved.ok).toBe(true);
  });

  it("accepts text-only preference only as an atomic current-message pair", () => {
    const result = validateConversationDecisionV3Semantics(decision({
      next_action: "update_candidate_state",
      chosen_actions: ["acknowledge_information", "record_work_preference"],
      patch: { preferred_work_mode: "text_only", video_allowed: false },
    }), context({
      latest_message: "Sadece mesajlasmak istiyorum, goruntulu istemiyorum",
      allowed_actions: ["acknowledge_information", "record_work_preference"],
    }));

    expect(result.ok).toBe(true);

    expectRejected(validateConversationDecisionV3Semantics(decision({
      next_action: "update_candidate_state",
      chosen_actions: ["acknowledge_information", "record_work_preference"],
      patch: { preferred_work_mode: "text_only", video_allowed: true },
    }), context({
      latest_message: "Sadece mesajlasmak istiyorum",
      allowed_actions: ["acknowledge_information", "record_work_preference"],
    })), "STATE_PATCH_TEXT_ONLY_PAIR_INCONSISTENT");
  });

  it("allows reply-content work disclosure only when grounded by an approved policy fact", () => {
    const valid = validateConversationDecisionV3Semantics(decision({
      next_action: "update_candidate_state",
      chosen_actions: ["acknowledge_information"],
      patch: { work_model_disclosed: true },
      evidence: [{ field: "work_model_disclosed", source: "reply_content", evidence_ref: null }],
      policy_facts_used: ["work_fact"],
    }), context());
    expect(valid.ok).toBe(true);

    expectRejected(validateConversationDecisionV3Semantics(decision({
      next_action: "update_candidate_state",
      chosen_actions: ["acknowledge_information"],
      patch: { work_model_disclosed: true },
      evidence: [{ field: "work_model_disclosed", source: "reply_content", evidence_ref: null }],
      policy_facts_used: [],
    }), context()), "STATE_PATCH_REPLY_EVIDENCE_INCOMPATIBLE");
  });

  it("blocks owner/group state mutation and candidate privileged report escalation", () => {
    expectRejected(validateConversationDecisionV3Semantics(decision({
      role: "owner",
      next_action: "update_candidate_state",
      chosen_actions: ["acknowledge_information"],
      patch: { age: 27 },
    }), context({ role: "owner", allowed_actions: ["acknowledge_information"] })), "ROLE_CANDIDATE_STATE_ACTION_DENIED");

    expectRejected(validateConversationDecisionV3Semantics(decision({
      next_action: "owner_report",
      chosen_actions: ["answer_user_question"],
    }), context()), "ROLE_PRIVILEGED_NEXT_ACTION_DENIED");

    expectRejected(validateConversationDecisionV3Semantics(decision({
      role: "group",
      next_action: "reply_only",
      chosen_actions: ["answer_user_question"],
    }), context({ role: "group", channel_type: "group", allowed_actions: ["answer_user_question"] })), "GROUP_DECISION_NOT_SAFE_IGNORED");
  });

  it("accepts a safe result with action-order variance only when the opt-in flag is enabled", () => {
    const safe = decision({
      next_action: "answer_direct_question",
      chosen_actions: ["answer_user_question"],
    });
    const strict = validateConversationDecisionV3Semantics(safe, context({
      allowed_actions: ["answer_user_question"],
      two_layer_validator_enabled: false,
    }));
    expect(strict.ok).toBe(true);
    expect(strict.layer_2_result).toBe("pass");

    const varied = validateConversationDecisionV3Semantics(decision({
      next_action: "ask_missing_info",
      chosen_actions: ["answer_user_question"],
    }), context({
      allowed_actions: ["answer_user_question"],
      two_layer_validator_enabled: true,
    }));
    expect(varied.ok).toBe(true);
    expect(varied.layer_1_result).toBe("pass");
    expect(varied.layer_2_result).toBe("accepted_with_variance");
    expect(varied.reason_codes).toEqual([]);
  });

  it("accepts grounded Layla selection with a follow-up missing-info action as Layer 2 variance", () => {
    const result = validateConversationDecisionV3Semantics(decision({
      reply: "Layla seçimini aldım; şimdi telefon türünü yazabilir misin?",
      next_action: "ask_missing_info",
      chosen_actions: ["acknowledge_information", "ask_phone_type"],
      patch: { selected_app: "Layla" },
      evidence: [{ field: "selected_app", source: "current_message", evidence_ref: null }],
    }), context({
      latest_message: "Layla",
      allowed_actions: ["acknowledge_information", "ask_phone_type"],
      two_layer_validator_enabled: true,
    }));

    expect(result.ok).toBe(true);
    expect(result.layer_1_result).toBe("pass");
    expect(result.layer_2_result).toBe("accepted_with_variance");
    expect(result.layer_1_reason_codes).toEqual([]);
    expect(result.layer_2_reason_codes).toContain("STATE_PATCH_WITHOUT_UPDATE_NEXT_ACTION");
  });

  it("keeps Layla state evidence strict even when Layer 2 variance is enabled", () => {
    const result = validateConversationDecisionV3Semantics(decision({
      reply: "Layla seçimini aldım.",
      next_action: "ask_missing_info",
      chosen_actions: ["acknowledge_information", "ask_phone_type"],
      patch: { selected_app: "Layla" },
      evidence: [],
    }), context({
      latest_message: "Android",
      allowed_actions: ["acknowledge_information", "ask_phone_type"],
      two_layer_validator_enabled: true,
    }));

    expect(result.ok).toBe(false);
    expect(result.layer_1_result).toBe("fail");
    expect(result.layer_1_reason_codes).toContain("STATE_PATCH_EVIDENCE_MISSING");
  });

  it("validates partial intake patches for age, gender, and daily hours", () => {
    const cases = [
      { latest_message: "27", patch: { age: 27 } },
      { latest_message: "erkek", patch: { gender: "erkek" } },
      { latest_message: "4 saat", patch: { daily_hours: 4 } },
    ] as const;

    for (const item of cases) {
      const result = validateConversationDecisionV3Semantics(decision({
        next_action: "update_candidate_state",
        chosen_actions: ["acknowledge_information"],
        patch: item.patch,
      }), context({
        latest_message: item.latest_message,
        allowed_actions: ["acknowledge_information"],
      }));
      expect(result.ok).toBe(true);
      expect(result.layer_1_result).toBe("pass");
    }
  });

  it("keeps every catalogued Layer 1 reason fail-closed and separates Layer 2", () => {
    for (const code of LAYER_1_REASON_CODES) expect(classifyValidatorReasonCode(code)).toBe("layer_1");
    for (const code of LAYER_2_REASON_CODES) expect(classifyValidatorReasonCode(code)).toBe("layer_2");
  });

  it("keeps unknown reason codes fail-closed and reports them separately", async () => {
    const { splitValidatorReasonCodes } = await import("../intelligence/conversation/ConversationValidatorReasonCatalog.js");
    expect(splitValidatorReasonCodes(["FUTURE_UNCLASSIFIED_REASON"])).toEqual({
      layer_1_reason_codes: ["FUTURE_UNCLASSIFIED_REASON"],
      layer_2_reason_codes: [],
      unknown_reason_codes: ["FUTURE_UNCLASSIFIED_REASON"],
    });
  });
});
