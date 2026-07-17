import { describe, expect, it } from "vitest";
import { ResponsesAdapter } from "../../modelAdapter/ResponsesAdapter.js";
import type { BackendContextPayloadV1 } from "../../contracts/backendContextPayload.js";
import type { ModelAdapterInput } from "../../modelAdapter/types.js";
import {
  CONVERSATION_DECISION_V3_SCHEMA_NAME,
  CONVERSATION_DECISION_V3_SCHEMA_VERSION,
  validateConversationDecisionV3Shape,
} from "../../intelligence/conversation/ConversationDecisionV3Schema.js";

function backendContext(): BackendContextPayloadV1 {
  return {
    backend_context_version: "1.0",
    correlation_id: "corr_responses_adapter",
    sender_role: "candidate",
    chat_type: "private",
    sender: { sender_id: "fixture_sender", phone_number: "fixture_sender" },
    chat: {
      remote_jid: "fixture_private_ref",
      message_id: "msg_responses_adapter",
      message_type: "conversation",
      is_from_me: false,
      is_group: false,
    },
    allowed_apps: ["Layla"],
    state: {
      current_state: "NEW_LEAD",
      age: null,
      gender: null,
      daily_hours: null,
      selected_app: null,
      phone_type: null,
      installation_status: "not_started",
      training_status: "not_started",
      missing_fields: ["age", "gender", "daily_hours"],
      expected_next_step: "ask_missing_info",
    },
    memory: {
      conversation_summary: "",
      last_5_user_messages: [],
      last_5_bot_replies: [],
      last_10_messages: [],
    },
    versions: {
      assistant_response_contract_version: "1.0",
      system_prompt_version: "1.0.0",
      knowledge_base_version: "2026.07.04",
      backend_context_version: "1.0",
      state_machine_version: "1.0",
    },
    user_message: { text: "Selam is icin yazdim", received_at: "2026-07-13T00:00:00.000Z" },
  };
}

function adapterInput(): ModelAdapterInput {
  return {
    tenantId: "now_os",
    conversationId: "conversation_responses_fixture",
    mode: "answer_mode",
    senderRole: "candidate",
    channelType: "private",
    normalizedUserMessage: "Selam is icin yazdim",
    contextPayload: backendContext(),
    responseContractVersion: "1.0",
    metadata: {
      traceId: "corr_responses_adapter",
      knowledgeVersion: "2026.07.04",
      featureFlags: {
        behavior_orchestrator_enabled: false,
        model_adapter_layer_enabled: false,
        model_adapter_canary_mode: "off",
        model_adapter_canary_tenants: [],
        model_adapter_canary_roles: ["owner", "manager"],
      },
    },
  };
}

function validDecisionJson(): string {
  return JSON.stringify({
    decision_version: CONVERSATION_DECISION_V3_SCHEMA_VERSION,
    intent: { primary: "candidate_first_contact", secondary: [], confidence: 0.94 },
    role: "candidate",
    direct_question: { present: false, question_summary: null, answered_in_reply: true },
    reply: {
      text: "Merhaba, yasinizi, cinsiyetinizi ve gunluk ayirabileceginiz sureyi yazar misiniz?",
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
  });
}

describe("ResponsesAdapter canonical contract", () => {
  it("calls Responses API with strict V3 schema through run", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const adapter = new ResponsesAdapter({
      model: "gpt-test-responses",
      runtime: { responses: { create: async (input) => {
        calls.push(input);
        return {
          id: "resp_fixture",
          status: "completed",
          output_text: validDecisionJson(),
          usage: { input_tokens: 12, output_tokens: 34 },
        };
      } } },
    });

    const output = await adapter.run(adapterInput());
    const parsed = JSON.parse(output.rawText) as Record<string, unknown>;

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      text: { format: { type: "json_schema", name: CONVERSATION_DECISION_V3_SCHEMA_NAME, strict: true } },
    });
    expect(calls[0]).not.toHaveProperty("timeout_ms");
    expect(validateConversationDecisionV3Shape(parsed).ok).toBe(true);
    expect(output.normalizedResponse).toBeNull();
    expect(output.usage).toEqual({ inputTokens: 12, outputTokens: 34 });
    expect(output.rawProviderResponseStored).toBe(false);
  });

  it("leaves invalid V3 output unnormalized for the backend validator", async () => {
    const adapter = new ResponsesAdapter({
      model: "gpt-test-responses",
      runtime: { responses: { create: async () => ({
        status: "completed",
        output_text: '{"contract_version":"1.0","reply":"old contract"}',
      }) } },
    });

    const output = await adapter.run(adapterInput());
    const parsed = JSON.parse(output.rawText) as Record<string, unknown>;

    expect(validateConversationDecisionV3Shape(parsed).ok).toBe(false);
    expect(output.normalizedResponse).toBeNull();
    expect(output.rawProviderResponseStored).toBe(false);
  });

  it("reports provider identity through the same interface", async () => {
    const adapter = new ResponsesAdapter({
      model: "gpt-test-responses",
      runtime: { responses: { create: async () => ({ output_text: validDecisionJson() }) } },
    });

    await expect(adapter.health()).resolves.toEqual({
      ok: true,
      provider: "openai_responses",
      supportsResponseContractVersion: "1.0",
    });
    expect(adapter.getIdentity()).toEqual({
      adapter_name: "ResponsesAdapter",
      provider: "openai_responses",
      model: "gpt-test-responses",
    });
  });

  it("does not expose provider payload metadata or transport identifiers", async () => {
    const adapter = new ResponsesAdapter({
      model: "gpt-test-responses",
      runtime: { responses: { create: async () => ({ output_text: validDecisionJson() }) } },
    });

    const output = await adapter.run(adapterInput());
    expect(JSON.stringify(output.providerTrace)).not.toMatch(/api[_-]?key|secret|@s\.whatsapp\.net|@g\.us/i);
  });
});
