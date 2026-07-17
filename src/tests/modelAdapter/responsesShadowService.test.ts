import { describe, expect, it, vi } from "vitest";
import type { IModelAdapter } from "../../modelAdapter/IModelAdapter.js";
import type { ModelAdapterInput, ModelAdapterOutput } from "../../modelAdapter/types.js";
import { ResponsesShadowService } from "../../modelAdapter/responsesShadowService.js";
import type { Logger, LogInput } from "../../observability/logger.js";
import { ModelExecutionService } from "../../modelAdapter/modelExecutionService.js";
import { FakeAssistantClient } from "../testDoubles.js";
import { InMemoryThreadStore } from "../../storage/threadStore.js";
import { CONVERSATION_DECISION_V3_SCHEMA_VERSION } from "../../intelligence/conversation/ConversationDecisionV3Schema.js";

function validDecision(role: "candidate" | "owner" = "owner"): string {
  return JSON.stringify({
    decision_version: CONVERSATION_DECISION_V3_SCHEMA_VERSION,
    intent: { primary: "answer_request", secondary: [], confidence: 0.9 },
    role,
    direct_question: { present: true, question_summary: "request", answered_in_reply: true },
    reply: { text: "Kisa ve guvenli cevap.", language: "tr", tone: "natural_concise", contains_question: false },
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

function input(overrides: Partial<ModelAdapterInput> = {}): ModelAdapterInput {
  return {
    tenantId: "canonical_tenant",
    conversationId: "conversation_private_identifier",
    mode: "answer_mode",
    senderRole: "owner",
    channelType: "private",
    normalizedUserMessage: "Guvenli bir soru",
    contextPayload: {
      backend_context_version: "1.0",
      correlation_id: "raw_correlation_identifier",
      sender_role: "owner",
      chat_type: "private",
      sender: { sender_id: "raw_sender_identifier", phone_number: "905000000000" },
      chat: {
        remote_jid: "raw-private@s.whatsapp.net",
        message_id: "raw_message_identifier",
        message_type: "conversation",
        is_from_me: false,
        is_group: false,
      },
      allowed_apps: [],
      state: {
        current_state: "NEW_LEAD",
        age: null,
        gender: null,
        daily_hours: null,
        selected_app: null,
        phone_type: null,
        installation_status: "not_started",
        training_status: "not_started",
        missing_fields: [],
        expected_next_step: "reply",
      },
      memory: { conversation_summary: "", last_5_user_messages: [], last_5_bot_replies: [], last_10_messages: [] },
      versions: {
        assistant_response_contract_version: "1.0",
        system_prompt_version: "1.0",
        knowledge_base_version: "1.0",
        backend_context_version: "1.0",
        state_machine_version: "1.0",
      },
      user_message: { text: "Guvenli bir soru", received_at: "2026-07-15T00:00:00.000Z" },
      conversation_decision_v2: {
        role: "owner",
        latest_message: { inferred_intent: "owner_answer" },
        candidate_state: {
          age: null,
          gender: null,
          daily_hours: null,
          work_model_acceptance: null,
          selected_app: null,
          phone_type: null,
        },
        canonical_policy_facts: [],
        allowed_actions: ["answer_user_question"],
        forbidden_actions: ["send_whatsapp", "write_state_directly", "invent_policy"],
      },
    },
    responseContractVersion: "1.0",
    metadata: {
      traceId: "raw_trace_identifier",
      featureFlags: {
        behavior_orchestrator_enabled: false,
        model_adapter_layer_enabled: false,
        model_adapter_canary_mode: "off",
        model_adapter_canary_tenants: [],
        model_adapter_canary_roles: [],
      },
    },
    ...overrides,
  };
}

function output(rawText = "primary output"): ModelAdapterOutput {
  return { normalizedResponse: null, rawText, rawProviderResponseStored: false };
}

class FakeAdapter implements IModelAdapter {
  readonly name = "FakeResponsesAdapter";
  readonly provider = "openai_responses";
  calls: ModelAdapterInput[] = [];
  constructor(private readonly result: () => Promise<string>) {}
  async run(value: ModelAdapterInput): Promise<ModelAdapterOutput> {
    this.calls.push(value);
    return output(await this.result());
  }
  async health() { return { ok: true, provider: this.provider, supportsResponseContractVersion: "1.0" as const }; }
  getIdentity() { return { adapter_name: this.name, provider: this.provider, model: "fixture" }; }
}

function recordingLogger(events: LogInput[]): Logger {
  return {
    debug: (event) => events.push(event),
    info: (event) => events.push(event),
    warn: (event) => events.push(event),
    error: (event) => events.push(event),
    fatal: (event) => events.push(event),
  };
}

describe("Responses shadow service", () => {
  it("is default-off and never invokes the provider", async () => {
    const adapter = new FakeAdapter(async () => validDecision());
    const service = new ResponsesShadowService(adapter, {
      enabled: false, mode: "off", tenants: [], roles: [], timeoutMs: 50,
    }, recordingLogger([]));

    service.observe(input(), output());
    await service.drain();

    expect(adapter.calls).toHaveLength(0);
    expect(service.snapshot()).toMatchObject({ last_status: "skipped", last_reason: "disabled_global", observations_total: 0 });
  });

  it("validates eligible output while sanitizing identifiers and telemetry", async () => {
    const events: LogInput[] = [];
    const adapter = new FakeAdapter(async () => validDecision());
    const service = new ResponsesShadowService(adapter, {
      enabled: true, mode: "internal", tenants: [], roles: ["owner"], timeoutMs: 100,
    }, recordingLogger(events));

    service.observe(input(), output());
    await service.drain();

    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0].contextPayload.sender).toEqual({ sender_id: "shadow_subject", phone_number: "shadow_subject" });
    expect(adapter.calls[0].contextPayload.chat.remote_jid).toBe("shadow_private_ref");
    expect(adapter.calls[0].metadata.traceId).not.toBe("raw_trace_identifier");
    expect(service.snapshot()).toMatchObject({ last_status: "valid", last_schema_valid: true, last_semantic_valid: true, last_role_match: true, last_reply_present: true, valid_total: 1 });
    const serialized = JSON.stringify(events);
    expect(serialized).not.toMatch(/905000000000|raw-private|raw_sender_identifier|Guvenli bir soru/);
    expect(events[0]).toMatchObject({ raw_text_logged: false, outbound_count: 0, state_write_count: 0 });
  });

  it("denies groups, disallowed roles, and tenants before provider execution", async () => {
    const adapter = new FakeAdapter(async () => validDecision());
    const service = new ResponsesShadowService(adapter, {
      enabled: true, mode: "tenant_allowlist", tenants: ["allowed"], roles: ["owner"], timeoutMs: 100,
    }, recordingLogger([]));

    service.observe(input({ channelType: "group" }), output());
    service.observe(input({ senderRole: "candidate" }), output());
    service.observe(input({ tenantId: "wrong" }), output());
    await service.drain();

    expect(adapter.calls).toHaveLength(0);
    expect(service.snapshot().last_reason).toBe("denied_tenant");
  });

  it("classifies invalid schema, role mismatch, provider errors, and timeout without throwing", async () => {
    const invalid = new ResponsesShadowService(new FakeAdapter(async () => "{}"), {
      enabled: true, mode: "internal", tenants: [], roles: ["owner"], timeoutMs: 100,
    }, recordingLogger([]));
    invalid.observe(input(), output());
    await invalid.drain();
    expect(invalid.snapshot().last_status).toBe("invalid");

    const mismatch = new ResponsesShadowService(new FakeAdapter(async () => validDecision("candidate")), {
      enabled: true, mode: "internal", tenants: [], roles: ["owner"], timeoutMs: 100,
    }, recordingLogger([]));
    mismatch.observe(input(), output());
    await mismatch.drain();
    expect(mismatch.snapshot()).toMatchObject({ last_status: "invalid", last_role_match: false });

    const providerError = new ResponsesShadowService(new FakeAdapter(async () => { throw new Error("secret provider details"); }), {
      enabled: true, mode: "internal", tenants: [], roles: ["owner"], timeoutMs: 100,
    }, recordingLogger([]));
    providerError.observe(input(), output());
    await providerError.drain();
    expect(providerError.snapshot()).toMatchObject({ last_status: "provider_error", last_reason: "provider_failure" });

    const timeout = new ResponsesShadowService(new FakeAdapter(() => new Promise(() => undefined)), {
      enabled: true, mode: "internal", tenants: [], roles: ["owner"], timeoutMs: 5,
    }, recordingLogger([]));
    timeout.observe(input(), output());
    await timeout.drain();
    expect(timeout.snapshot()).toMatchObject({ last_status: "timeout", last_reason: "deadline_exceeded", timeout_total: 1 });
  });

  it("does not delay or replace the canonical Assistant result", async () => {
    let resolveShadow!: (value: string) => void;
    const adapter = new FakeAdapter(() => new Promise((resolve) => { resolveShadow = resolve; }));
    const shadow = new ResponsesShadowService(adapter, {
      enabled: true, mode: "internal", tenants: [], roles: ["owner"], timeoutMs: 1000,
    }, recordingLogger([]));
    const client = new FakeAssistantClient(['{"contract_version":"1.0","reply":"Canonical reply","internal_boss_note":""}']);
    const service = new ModelExecutionService(client, new InMemoryThreadStore(), {
      modelAdapterLayerEnabled: false,
      modelAdapterCanaryMode: "off",
      responsesShadowObserver: shadow,
    });

    const canonical = await service.execute(input());
    expect(canonical.rawText).toContain("Canonical reply");
    expect(adapter.calls).toHaveLength(1);
    expect(shadow.snapshot().observations_total).toBe(0);

    resolveShadow(validDecision());
    await shadow.drain();
    expect(shadow.snapshot().last_status).toBe("valid");
    expect(canonical.rawText).toContain("Canonical reply");
  });
});
