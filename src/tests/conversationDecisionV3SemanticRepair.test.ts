import { describe, expect, it } from "vitest";
import { buildBackendContext } from "../bridge/buildBackendContext.js";
import type { NormalizedIncomingMessage } from "../bridge/normalizeEvolutionMessage.js";
import { executeConversationDecisionV2 } from "../intelligence/conversation/ConversationDecisionEngine.js";
import type { ModelExecutionService } from "../modelAdapter/modelExecutionService.js";
import { InMemoryStore } from "../storage/memoryStore.js";
import {
  createSilentLogger,
  createTestEnv,
  InMemoryUserStateStore,
} from "./testDoubles.js";

const CANDIDATE_PHONE = "905550000002";

function profileQuestion(): NormalizedIncomingMessage {
  return {
    correlation_id: "corr_v3_semantic_patch_repair",
    sender_id: CANDIDATE_PHONE,
    phone_number: CANDIDATE_PHONE,
    remote_jid: `${CANDIDATE_PHONE}@s.whatsapp.net`,
    message_id: "msg_v3_semantic_patch_repair",
    message_type: "conversation",
    text: "Erkek hesabi mi acacagim?",
    chat_type: "private",
    is_from_me: false,
    is_group: false,
    received_at: "2026-08-17T12:00:00.000Z",
  };
}

function responseWithPatch(selectedApp: string | null): string {
  return JSON.stringify({
    decision_version: "3.1",
    intent: { primary: "account_profile_question", secondary: [], confidence: 0.95 },
    role: "candidate",
    direct_question: {
      present: true,
      question_summary: "Aday profil kurali soruyor",
      answered_in_reply: true,
    },
    reply: {
      text: "Profil kurali onayli bilgiye gore netlestirilir.",
      language: "tr",
      tone: "natural_concise",
      contains_question: false,
    },
    next_action: "reply_only",
    chosen_actions: ["answer_user_question"],
    state_patch: {
      age: null,
      gender: null,
      daily_hours: null,
      work_model_acceptance: null,
      selected_app: selectedApp,
      phone_type: null,
      work_model_disclosed: null,
      preferred_work_mode: null,
      video_allowed: null,
    },
    state_patch_evidence: selectedApp === null
      ? []
      : [{ field: "selected_app", source: "current_message", evidence_ref: null }],
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
  });
}

describe("ConversationDecisionEngine V3 semantic patch repair", () => {
  it("repairs an unsupported state patch instead of discarding a safe direct answer", async () => {
    const env = createTestEnv({
      conversationDecisionV2Enabled: true,
      modelAdapterLayerEnabled: true,
      twoLayerValidatorEnabled: true,
      approvedApps: ["Layla"],
    });
    const stateStore = new InMemoryUserStateStore();
    const incoming = profileQuestion();
    const backendContext = buildBackendContext(incoming, env, new InMemoryStore(), stateStore);
    const outputs = [responseWithPatch("Layla"), responseWithPatch(null)];
    const logger = createSilentLogger();
    const execute = async () => ({
      normalizedResponse: null,
      rawText: outputs.shift() ?? responseWithPatch(null),
      providerTrace: {
        provider: "openai_responses",
        adapter: "responses_adapter",
        response_contract_version: "1.0",
      },
      rawProviderResponseStored: false as const,
    });

    const result = await executeConversationDecisionV2({
      message: incoming,
      backendContext,
      conversationId: `now_os:private:${CANDIDATE_PHONE}`,
      capturedFields: [],
      env,
      modelExecutionService: { execute } as unknown as ModelExecutionService,
      logger,
    });

    expect(result.model_call_count).toBe(2);
    expect(result.repair_attempted).toBe(true);
    expect(result.origin).toBe("conversation_decision_v2_model_repair");
    expect(result.mutation_source).toBe("model_repair");
    expect(result.layer_1_result).toBe("pass");
    expect(result.state_patch_reason_codes).toEqual([]);
    expect(result.nextState.selected_app).toBeNull();
    expect(result.finalReply).toContain("Profil kurali");
    expect(result.finalReply).not.toMatch(/kontrol ediyorum|ekip/i);
    expect(logger.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event_type: "CONVERSATION_DECISION_V3_SEMANTIC_REPAIR_REQUESTED",
        reason_codes: ["STATE_PATCH_CURRENT_MESSAGE_EVIDENCE_MISMATCH"],
      }),
    ]));
  });
});
