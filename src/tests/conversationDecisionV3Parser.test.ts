import { describe, expect, it } from "vitest";
import {
  parseConversationDecisionV3Response,
} from "../intelligence/conversation/ConversationDecisionV3Parser.js";
import { defaultUserState } from "../storage/types.js";
import type { BackendContextPayloadV1 } from "../contracts/backendContextPayload.js";
import type { ModelAdapterInput } from "../modelAdapter/types.js";

function v3Decision(role: "candidate" | "owner" | "manager") {
  return JSON.stringify({
    decision_version: "3.1",
    intent: { primary: "status_request", secondary: [], confidence: 0.91 },
    role,
    direct_question: { present: false, question_summary: null, answered_in_reply: true },
    reply: {
      text: `${role} cevabi`,
      language: "tr",
      tone: role === "candidate" ? "natural_concise" : "managerial",
      contains_question: false,
    },
    next_action: "reply_only",
    chosen_actions: ["answer_user_question"],
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
  });
}

function adapterInput(role: "candidate" | "owner" | "manager"): ModelAdapterInput {
  const contextPayload = {
    state: defaultUserState(),
    allowed_apps: ["Layla"],
    user_message: { text: "Durum nedir?" },
    conversation_decision_v2: {
      allowed_actions: ["answer_user_question"],
      canonical_policy_facts: [],
    },
  } as unknown as BackendContextPayloadV1;

  return {
    tenantId: "now_os",
    conversationId: `now_os:${role}:test`,
    mode: "conversation_decision_v2",
    senderRole: role,
    channelType: "private",
    normalizedUserMessage: "Durum nedir?",
    contextPayload,
    responseContractVersion: "1.0",
    metadata: {
      traceId: `trace-${role}`,
      featureFlags: {
        behavior_orchestrator_enabled: false,
        model_adapter_layer_enabled: true,
        model_adapter_canary_mode: "off",
        model_adapter_canary_tenants: [],
        model_adapter_canary_roles: [],
      },
    },
  };
}

describe("ConversationDecisionV3 parser", () => {
  it.each(["candidate", "owner", "manager"] as const)(
    "parses %s traffic through the same V3 decision contract",
    (role) => {
      const result = parseConversationDecisionV3Response({
        rawText: v3Decision(role),
        adapterInput: adapterInput(role),
        origin: "conversation_decision_v2_model",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.decision.reply.text).toBe(`${role} cevabi`);
      expect(result.decision.decision_version).toBe("2.0");
      expect(result.decision.state_patch_evidence).toEqual([]);
    },
  );

  it("rejects retired AssistantResponseContract v1 output", () => {
    const result = parseConversationDecisionV3Response({
      rawText: '{"contract_version":"1.0","reply":"old","internal_boss_note":""}',
      adapterInput: adapterInput("owner"),
      origin: "conversation_decision_v2_model",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error_code).toBe("SHAPE_INVALID");
  });
});
