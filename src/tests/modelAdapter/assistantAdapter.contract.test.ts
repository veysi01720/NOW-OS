import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AssistantAdapter } from "../../modelAdapter/AssistantAdapter.js";
import type { ModelAdapterInput } from "../../modelAdapter/types.js";
import { FakeAssistantClient } from "../testDoubles.js";
import { InMemoryThreadStore } from "../../storage/threadStore.js";
import type { BackendContextPayloadV1 } from "../../contracts/backendContextPayload.js";

function backendContext(): BackendContextPayloadV1 {
  return {
    backend_context_version: "1.0",
    correlation_id: "corr_adapter",
    sender_role: "candidate",
    chat_type: "private",
    sender: { sender_id: "fixture_user", phone_number: "fixture_user" },
    chat: {
      remote_jid: "fixture_private_ref",
      message_id: "msg_adapter",
      message_type: "conversation",
      is_from_me: false,
      is_group: false,
    },
    allowed_apps: ["Layla"],
    state: {
      current_state: "CANDIDATE_INTAKE",
      age: null,
      gender: null,
      daily_hours: null,
      selected_app: null,
      phone_type: null,
      installation_status: "not_started",
      training_status: "not_started",
      missing_fields: ["selected_app", "phone_type"],
      expected_next_step: "ask_selected_app_or_phone_type",
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
    user_message: {
      text: "Merhaba",
      received_at: "2026-07-11T00:00:00.000Z",
    },
  };
}

function adapterInput(context = backendContext()): ModelAdapterInput {
  return {
    tenantId: "now_os",
    conversationId: "conversation_fixture",
    mode: "answer_mode",
    senderRole: "candidate",
    channelType: "private",
    normalizedUserMessage: "Merhaba",
    contextPayload: context,
    responseContractVersion: "1.0",
    metadata: {
      traceId: "corr_adapter",
      knowledgeVersion: "2026.07.04",
      featureFlags: {
        behavior_orchestrator_enabled: false,
        model_adapter_layer_enabled: true,
        model_adapter_canary_mode: "off",
        model_adapter_canary_tenants: [],
        model_adapter_canary_roles: ["owner", "manager"],
      },
    },
  };
}

describe("AssistantAdapter contract", () => {
  it("implements IModelAdapter and returns normalized response for v1 contract", async () => {
    const adapter = new AssistantAdapter(
      new FakeAssistantClient(['{"contract_version":"1.0","reply":"Merhaba","internal_boss_note":"operator only"}']),
      new InMemoryThreadStore(),
    );

    const output = await adapter.run(adapterInput());

    expect(adapter.name).toBe("AssistantAdapter");
    expect(adapter.provider).toBe("openai_assistant");
    expect(output.normalizedResponse).toEqual({
      reply: "Merhaba",
      internal_boss_note: "operator only",
    });
    expect(output.providerTrace).toEqual({
      provider: "openai_assistant",
      adapter: "AssistantAdapter",
      response_contract_version: "1.0",
    });
    expect(output.rawProviderResponseStored).toBe(false);
  });

  it("preserves current assistant thread mapping through ThreadStore", async () => {
    const client = new FakeAssistantClient([
      '{"contract_version":"1.0","reply":"Bir","internal_boss_note":""}',
      '{"contract_version":"1.0","reply":"Iki","internal_boss_note":""}',
    ]);
    const threadStore = new InMemoryThreadStore();
    const adapter = new AssistantAdapter(client, threadStore);

    await adapter.run(adapterInput());
    await adapter.run(adapterInput());

    expect(client.createThreadCalls).toBe(1);
    expect(client.runCalls).toHaveLength(2);
    expect(client.runCalls[0]?.threadId).toBe(client.runCalls[1]?.threadId);
  });

  it("does not expose invalid contract as normalized response", async () => {
    const adapter = new AssistantAdapter(
      new FakeAssistantClient(["plain text invalid"]),
      new InMemoryThreadStore(),
    );

    const output = await adapter.run(adapterInput());

    expect(output.normalizedResponse).toBeNull();
    expect(output.rawText).toBe("plain text invalid");
    expect(output.rawProviderResponseStored).toBe(false);
  });

  it("keeps provider unchanged and Responses API unused", () => {
    const adapterSource = readFileSync(join(process.cwd(), "src/modelAdapter/AssistantAdapter.ts"), "utf8");
    const clientSource = readFileSync(join(process.cwd(), "src/assistant/openaiAssistantClient.ts"), "utf8");

    expect(adapterSource).toContain('readonly provider = "openai_assistant"');
    expect(clientSource).toContain("beta.threads.runs.createAndPoll");
    expect(`${adapterSource}\n${clientSource}`).not.toContain(".responses.");
    expect(`${adapterSource}\n${clientSource}`).not.toMatch(/Claude|DeepSeek|OpenRouter|Kimi/i);
  });

  it("keeps raw phone, jid, group id, and raw text out of provider trace", async () => {
    const adapter = new AssistantAdapter(
      new FakeAssistantClient(['{"contract_version":"1.0","reply":"Tamam","internal_boss_note":""}']),
      new InMemoryThreadStore(),
    );

    const output = await adapter.run(adapterInput());
    const trace = JSON.stringify(output.providerTrace);

    expect(trace).not.toContain("fixture_private_ref");
    expect(trace).not.toContain("Merhaba");
    expect(trace).not.toContain("@s.whatsapp.net");
    expect(trace).not.toContain("@g.us");
  });
});
