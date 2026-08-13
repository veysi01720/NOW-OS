import { describe, expect, it } from "vitest";
import { mapConversationDecisionV3ToBackendDecision } from "../intelligence/conversation/ConversationDecisionV3Mapper.js";
import { CONVERSATION_DECISION_V3_SCHEMA_VERSION, type ConversationDecisionV3 } from "../intelligence/conversation/ConversationDecisionV3Schema.js";

function v3(overrides: Partial<ConversationDecisionV3> = {}): ConversationDecisionV3 {
  return {
    decision_version: CONVERSATION_DECISION_V3_SCHEMA_VERSION,
    intent: { primary: "fixture", secondary: [], confidence: 1 },
    role: "candidate",
    direct_question: { present: false, question_summary: null, answered_in_reply: true },
    reply: { text: "Tamam", language: "tr", tone: "natural_concise", contains_question: false },
    chosen_actions: ["acknowledge_information"],
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
    next_action: "reply_only",
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

describe("V3 runtime parity mapping", () => {
  it("keeps record_work_preference and its state patch in the backend decision", () => {
    const mapped = mapConversationDecisionV3ToBackendDecision(v3({
      chosen_actions: ["acknowledge_information", "record_work_preference"],
      next_action: "update_candidate_state",
      state_patch: {
        age: null,
        gender: null,
        daily_hours: null,
        work_model_acceptance: null,
        selected_app: null,
        phone_type: null,
        work_model_disclosed: null,
        preferred_work_mode: "text_only",
        video_allowed: false,
      },
    }), "conversation_decision_v2_model");

    expect(mapped.chosen_actions).toContain("record_work_preference");
    expect(mapped.next_action).toBe("update_candidate_state");
    expect(mapped.state_patch.preferred_work_mode).toBe("text_only");
    expect(mapped.state_patch.video_allowed).toBe(false);
  });

  it("preserves V3 orchestration actions for state transitions and handoff", () => {
    expect(mapConversationDecisionV3ToBackendDecision(v3({
      chosen_actions: ["acknowledge_information"],
      next_action: "update_candidate_state",
    }), "conversation_decision_v2_model").next_action).toBe("update_candidate_state");

    expect(mapConversationDecisionV3ToBackendDecision(v3({
      chosen_actions: ["escalate_policy_missing"],
      next_action: "request_human_handoff",
      requires_escalation: true,
      escalation_reason: "policy_missing",
    }), "conversation_decision_v2_model").next_action).toBe("request_human_handoff");
  });
});
