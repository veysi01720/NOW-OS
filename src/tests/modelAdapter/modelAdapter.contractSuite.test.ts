import { describe, expect, it } from "vitest";
import type { IModelAdapter } from "../../modelAdapter/IModelAdapter.js";
import { AssistantAdapter } from "../../modelAdapter/AssistantAdapter.js";
import type { ModelAdapterInput, ModelAdapterOutput } from "../../modelAdapter/types.js";
import type { BackendContextPayloadV1 } from "../../contracts/backendContextPayload.js";
import { parseAssistantResponseV1 } from "../../contracts/assistantResponseContract.js";
import { FakeAssistantClient } from "../testDoubles.js";
import { InMemoryThreadStore } from "../../storage/threadStore.js";

function backendContext(): BackendContextPayloadV1 {
  return {
    backend_context_version: "1.0",
    correlation_id: "corr_contract_fixture",
    sender_role: "owner",
    chat_type: "private",
    sender: { sender_id: "safe_sender_ref", phone_number: "safe_sender_ref" },
    chat: {
      remote_jid: "safe_private_ref",
      message_id: "safe_message_ref",
      message_type: "conversation",
      is_from_me: false,
      is_group: false,
    },
    allowed_apps: ["Layla"],
    state: {
      current_state: "NON_CANDIDATE",
      age: null,
      gender: null,
      daily_hours: null,
      selected_app: null,
      phone_type: null,
      installation_status: "not_applicable",
      training_status: "not_applicable",
      missing_fields: [],
      expected_next_step: "none",
    },
    memory: {
      conversation_summary: "safe synthetic summary",
      last_5_user_messages: ["safe previous question"],
      last_5_bot_replies: ["safe previous answer"],
      last_10_messages: ["safe previous question", "safe previous answer"],
    },
    versions: {
      assistant_response_contract_version: "1.0",
      system_prompt_version: "1.0.0",
      knowledge_base_version: "2026.07.04",
      backend_context_version: "1.0",
      state_machine_version: "1.0",
    },
    user_message: {
      text: "safe synthetic question",
      received_at: "2026-07-11T00:00:02.000Z",
    },
    answer_plan: {
      sender_role: "owner",
      mode: "answer_mode",
      intent: "normal_chat",
      relevant_app_fact: {
        app: "Layla",
        android_name: "Layla",
        ios_name: "NIVI",
        invite_code: "safe_code",
        agency_bind_code: "safe_bind",
        agency_code: "safe_agency",
        official_url: "",
        status: "",
        notes: "",
      },
      relevant_link_item: null,
      relevant_knowledge_rules: ["safe_rule"],
      hard_rules: ["answer_from_backend_context_and_approved_knowledge"],
      style_rules: ["short_whatsapp_style"],
      escalation_required: false,
      confidence: 0.9,
      source_count: 1,
    },
  };
}

function adapterInput(): ModelAdapterInput {
  const context = backendContext();
  return {
    tenantId: "now_os",
    conversationId: "safe_conversation_ref",
    mode: "answer_mode",
    senderRole: "owner",
    channelType: "private",
    normalizedUserMessage: "safe synthetic question",
    contextPayload: context,
    retrievedKnowledge: { sourceCount: 1, ruleIds: ["safe_rule"] },
    behaviorContext: undefined,
    responseContractVersion: "1.0",
    metadata: {
      traceId: "corr_contract_fixture",
      knowledgeVersion: "2026.07.04",
      featureFlags: {
        behavior_orchestrator_enabled: false,
        model_adapter_layer_enabled: true,
        model_adapter_canary_mode: "internal",
        model_adapter_canary_tenants: [],
        model_adapter_canary_roles: ["owner", "manager"],
      },
    },
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertProviderNeutralOutput(output: ModelAdapterOutput): void {
  const serialized = JSON.stringify(output);
  expect(serialized).not.toContain("thread_");
  expect(serialized).not.toContain("run_id");
  expect(serialized).not.toContain('"id":"run_');
  expect(serialized).not.toContain("beta.threads");
  expect(serialized).not.toContain("choices");
  expect(serialized).not.toContain("content_block");
  expect(serialized).not.toContain("api_key");
  expect(serialized).not.toContain("@s.whatsapp.net");
  expect(serialized).not.toContain("@g.us");
}

function runModelAdapterContractTests(input: {
  name: string;
  createAdapter: (rawResponse: string) => IModelAdapter;
}): void {
  describe(`${input.name} provider-neutral contract`, () => {
    it("returns normalized v1 output without mutating input", async () => {
      const adapter = input.createAdapter(
        '{"contract_version":"1.0","reply":"Layla iPhone uygulamasinin adi NIVI.","internal_boss_note":"operator only"}',
      );
      const request = adapterInput();
      const before = clone(request);

      const output = await adapter.run(request);

      expect(request).toEqual(before);
      expect(output.normalizedResponse).toEqual({
        reply: "Layla iPhone uygulamasinin adi NIVI.",
        internal_boss_note: "operator only",
      });
      expect(typeof output.normalizedResponse?.reply).toBe("string");
      expect(output.normalizedResponse?.reply.trim()).not.toBe("");
      expect(output.rawProviderResponseStored).toBe(false);
      expect(output.providerTrace).toEqual({
        provider: adapter.provider,
        adapter: adapter.name,
        response_contract_version: "1.0",
      });
      assertProviderNeutralOutput(output);
    });

    it("preserves unicode and multiline valid replies", async () => {
      const adapter = input.createAdapter(
        '{"contract_version":"1.0","reply":"NIVI dogru ad.\\nIkinci satir da korunur.","internal_boss_note":""}',
      );

      const output = await adapter.run(adapterInput());

      expect(output.normalizedResponse?.reply).toBe("NIVI dogru ad.\nIkinci satir da korunur.");
      expect(output.normalizedResponse?.internal_boss_note).toBe("");
    });

    it("accepts optional provider-neutral lifecycle hints without leaking them to output", async () => {
      const adapter = input.createAdapter(
        '{"contract_version":"1.0","reply":"Lifecycle ok","internal_boss_note":""}',
      );
      const controller = new AbortController();
      const request = {
        ...adapterInput(),
        execution: {
          signal: controller.signal,
          timeoutMs: 45_000,
        },
      };

      const output = await adapter.run(request);
      const serialized = JSON.stringify(output);

      expect(output.normalizedResponse?.reply).toBe("Lifecycle ok");
      expect(serialized).not.toContain("AbortSignal");
      expect(serialized).not.toContain("timeoutMs");
      expect(serialized).not.toContain("45000");
      assertProviderNeutralOutput(output);
    });

    it.each([
      ["empty response", ""],
      ["whitespace response", "   "],
      ["plain text", "raw unstructured provider output"],
      ["malformed json", '{"contract_version":"1.0","reply":'],
      ["json before explanation", 'Here: {"contract_version":"1.0","reply":"x","internal_boss_note":""}'],
      ["json after explanation", '{"contract_version":"1.0","reply":"x","internal_boss_note":""}\nextra'],
      ["two json blocks", '{"contract_version":"1.0","reply":"x","internal_boss_note":""}\n{"contract_version":"1.0","reply":"y","internal_boss_note":""}'],
      ["code fence", '```json\n{"contract_version":"1.0","reply":"x","internal_boss_note":""}\n```'],
      ["object reply", '{"contract_version":"1.0","reply":{},"internal_boss_note":""}'],
      ["array reply", '{"contract_version":"1.0","reply":[],"internal_boss_note":""}'],
      ["null reply", '{"contract_version":"1.0","reply":null,"internal_boss_note":""}'],
      ["missing reply", '{"contract_version":"1.0","internal_boss_note":"operator only"}'],
      ["internal note only", '{"contract_version":"1.0","internal_boss_note":"Kullanicıya bunu gonder"}'],
      ["empty reply with note", '{"contract_version":"1.0","reply":"   ","internal_boss_note":"debug private"}'],
      ["wrong contract", '{"contract_version":"1.1","reply":"x","internal_boss_note":""}'],
      ["array top-level", '[{"contract_version":"1.0","reply":"x","internal_boss_note":""}]'],
    ])("rejects malformed provider response: %s", async (_name, rawResponse) => {
      const adapter = input.createAdapter(rawResponse);

      const output = await adapter.run(adapterInput());

      expect(output.normalizedResponse).toBeNull();
      expect(output.rawProviderResponseStored).toBe(false);
      assertProviderNeutralOutput(output);
    });

    it("never promotes internal_boss_note as public reply", async () => {
      const adapter = input.createAdapter(
        '{"contract_version":"1.0","reply":"Kisa cevap","internal_boss_note":"Kullaniciya sunu uzun uzun soyle: gizli debug"}',
      );

      const output = await adapter.run(adapterInput());

      expect(output.normalizedResponse?.reply).toBe("Kisa cevap");
      expect(output.normalizedResponse?.reply).not.toContain("gizli debug");
      expect(output.normalizedResponse?.internal_boss_note).toContain("gizli debug");
    });
  });
}

runModelAdapterContractTests({
  name: "AssistantAdapter",
  createAdapter: (rawResponse) =>
    new AssistantAdapter(new FakeAssistantClient([rawResponse]), new InMemoryThreadStore()),
});

class ValidFakeAdapter implements IModelAdapter {
  readonly name: string = "ValidFakeAdapter";
  readonly provider: string = "fake_provider";

  async run(_input: ModelAdapterInput): Promise<ModelAdapterOutput> {
    return {
      normalizedResponse: { reply: "ok", internal_boss_note: "" },
      rawText: '{"contract_version":"1.0","reply":"ok","internal_boss_note":""}',
      providerTrace: { provider: this.provider, adapter: this.name, response_contract_version: "1.0" },
      rawProviderResponseStored: false,
    };
  }

  async health() {
    return { ok: true, provider: this.provider, supportsResponseContractVersion: "1.0" as const };
  }

  getIdentity() {
    return { adapter_name: this.name, provider: this.provider, model: "fake_model" };
  }
}

class EmptyReplyFakeAdapter extends ValidFakeAdapter {
  readonly name: string = "EmptyReplyFakeAdapter";

  async run(_input: ModelAdapterInput): Promise<ModelAdapterOutput> {
    return {
      normalizedResponse: { reply: "   ", internal_boss_note: "" },
      rawText: '{"contract_version":"1.0","reply":"   ","internal_boss_note":""}',
      providerTrace: { provider: this.provider, adapter: this.name, response_contract_version: "1.0" },
      rawProviderResponseStored: false,
    };
  }
}

class RawProviderLeakFakeAdapter extends ValidFakeAdapter {
  readonly name: string = "RawProviderLeakFakeAdapter";

  async run(_input: ModelAdapterInput): Promise<ModelAdapterOutput> {
    return {
      normalizedResponse: { reply: "ok", internal_boss_note: "" },
      rawText: "ok",
      providerTrace: {
        provider: this.provider,
        adapter: this.name,
        response_contract_version: "1.0",
        sdk_response: { run_id: "run_leak" },
      } as never,
      rawProviderResponseStored: false,
    };
  }
}

describe("model adapter contract suite catches invalid fake adapters", () => {
  it("accepts a valid fake adapter shape", async () => {
    const output = await new ValidFakeAdapter().run(adapterInput());
    expect(output.normalizedResponse?.reply).toBe("ok");
    expect(output.rawProviderResponseStored).toBe(false);
  });

  it("detects empty public reply from fake adapter", async () => {
    const output = await new EmptyReplyFakeAdapter().run(adapterInput());
    expect(output.normalizedResponse?.reply.trim()).toBe("");
    expect(parseAssistantResponseV1(output.rawText).ok).toBe(false);
  });

  it("detects provider-specific raw metadata leakage from fake adapter", async () => {
    const output = await new RawProviderLeakFakeAdapter().run(adapterInput());
    expect(JSON.stringify(output.providerTrace)).toContain("run_leak");
    expect(JSON.stringify(output.providerTrace)).toContain("sdk_response");
  });
});
