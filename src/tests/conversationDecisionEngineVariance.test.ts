import { describe, expect, it } from "vitest";
import { buildBackendContext } from "../bridge/buildBackendContext.js";
import type { NormalizedIncomingMessage } from "../bridge/normalizeEvolutionMessage.js";
import { executeConversationDecisionV2 } from "../intelligence/conversation/ConversationDecisionEngine.js";
import type { ModelExecutionService } from "../modelAdapter/modelExecutionService.js";
import { InMemoryStore } from "../storage/memoryStore.js";
import { defaultUserState } from "../storage/types.js";
import {
  createSilentLogger,
  createTestEnv,
  InMemoryUserStateStore,
} from "./testDoubles.js";

const CANDIDATE_PHONE = "905550000001";

function message(): NormalizedIncomingMessage {
  return {
    correlation_id: "corr_v3_clarification_variance",
    sender_id: CANDIDATE_PHONE,
    phone_number: CANDIDATE_PHONE,
    remote_jid: `${CANDIDATE_PHONE}@s.whatsapp.net`,
    message_id: "msg_v3_clarification_variance",
    message_type: "conversation",
    text: "Bunu anlamadim",
    chat_type: "private",
    is_from_me: false,
    is_group: false,
    received_at: "2026-08-17T12:00:00.000Z",
  };
}

function v3ClarificationDecision(): string {
  return JSON.stringify({
    decision_version: "3.1",
    intent: { primary: "candidate_next_step", secondary: [], confidence: 0.96 },
    role: "candidate",
    direct_question: {
      present: false,
      question_summary: null,
      answered_in_reply: true,
    },
    reply: {
      text: "Kisaca: uygulamadaki mesajlara yazi ile cevap vererek ilerlersin.",
      language: "tr",
      tone: "natural_concise",
      contains_question: false,
    },
    next_action: "reply_only",
    chosen_actions: ["answer_user_question", "clarify_previous_explanation"],
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
    missing_fields: ["model_acceptance"],
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

describe("ConversationDecisionEngine legacy variance handling", () => {
  it("keeps a semantically valid V3 clarification out of the deterministic fallback", async () => {
    const env = createTestEnv({
      conversationDecisionV2Enabled: true,
      modelAdapterLayerEnabled: true,
      twoLayerValidatorEnabled: true,
      approvedApps: ["Layla"],
    });
    const stateStore = new InMemoryUserStateStore();
    stateStore.updateState(CANDIDATE_PHONE, {
      ...defaultUserState(),
      current_state: "WORK_MODEL_ACCEPTANCE",
      age: 27,
      gender: "erkek",
      daily_hours: 4,
      eligibility_status: "eligible",
      work_model_disclosed: true,
      model_acceptance: "pending",
      missing_fields: ["model_acceptance"],
      expected_next_step: "ask_work_model_acceptance",
    });
    const incoming = message();
    const backendContext = buildBackendContext(incoming, env, new InMemoryStore(), stateStore);
    const execute = async () => ({
      normalizedResponse: null,
      rawText: v3ClarificationDecision(),
      providerTrace: {
        provider: "openai_responses",
        adapter: "responses_adapter",
        response_contract_version: "1.0",
      },
      rawProviderResponseStored: false as const,
    });
    const logger = createSilentLogger();

    const result = await executeConversationDecisionV2({
      message: incoming,
      backendContext,
      conversationId: `now_os:private:${CANDIDATE_PHONE}`,
      capturedFields: [],
      env,
      modelExecutionService: { execute } as unknown as ModelExecutionService,
      logger,
    });

    expect(result.origin).toBe("conversation_decision_v2_model_repair");
    expect(result.mutation_source).toBe("model_repair");
    expect(result.finalReply).toContain("mesajlara yazi ile cevap");
    expect(result.finalReply).not.toMatch(/ekip|kontrol/iu);
    expect(result.model_call_count).toBe(2);
    expect(result.layer_1_result).toBe("pass");
    expect(result.layer_2_result).toBe("accepted_with_variance");
    expect(result.layer_2_reason_codes).toContain("CLARIFICATION_INTENT_NOT_RECOGNIZED");
  });
});
