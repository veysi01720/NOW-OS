import { describe, expect, it } from "vitest";
import { ModelExecutionService } from "../../modelAdapter/modelExecutionService.js";
import type { ModelAdapterInput } from "../../modelAdapter/types.js";
import type { BackendContextPayloadV1 } from "../../contracts/backendContextPayload.js";
import { InMemoryThreadStore } from "../../storage/threadStore.js";
import { FakeAssistantClient } from "../testDoubles.js";
import { parseAssistantResponseV1 } from "../../contracts/assistantResponseContract.js";

function backendContext(): BackendContextPayloadV1 {
  return {
    backend_context_version: "1.0",
    correlation_id: "corr_exec",
    sender_role: "owner",
    chat_type: "private",
    sender: { sender_id: "safe_sender", phone_number: "safe_sender" },
    chat: {
      remote_jid: "safe_private_ref",
      message_id: "msg_exec",
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
      installation_status: "not_applicable",
      training_status: "not_applicable",
      missing_fields: [],
      expected_next_step: "none",
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
      text: "safe question",
      received_at: "2026-07-11T00:00:00.000Z",
    },
  };
}

function modelInput(overrides: Partial<ModelAdapterInput["metadata"]["featureFlags"]> = {}): ModelAdapterInput {
  return {
    tenantId: "now_os",
    conversationId: "conversation_exec",
    mode: "answer_mode",
    senderRole: "owner",
    channelType: "private",
    normalizedUserMessage: "safe question",
    contextPayload: backendContext(),
    responseContractVersion: "1.0",
    metadata: {
      traceId: "corr_exec",
      knowledgeVersion: "2026.07.04",
      featureFlags: {
        behavior_orchestrator_enabled: false,
        model_adapter_layer_enabled: false,
        model_adapter_canary_mode: "off",
        model_adapter_canary_tenants: [],
        model_adapter_canary_roles: ["owner", "manager"],
        ...overrides,
      },
    },
  };
}

describe("ModelExecutionService adapter selection", () => {
  it("uses legacy-equivalent boundary path when scoped adapter is off", async () => {
    const client = new FakeAssistantClient([
      '{"contract_version":"1.0","reply":"Legacy ok","internal_boss_note":"operator"}',
    ]);
    const service = new ModelExecutionService(client, new InMemoryThreadStore());

    const output = await service.execute(modelInput());

    expect(output.providerTrace?.adapter).toBe("legacy_assistant_boundary");
    expect(output.normalizedResponse).toBeNull();
    expect(output.rawText).toContain("Legacy ok");
    expect(service.snapshot().model_adapter_current_decision).toEqual({
      use_adapter_layer: false,
      reason: "disabled_mode_off",
      canary_scope: "off",
    });
  });

  it("executes flag-off legacy behavior through the canonical adapter interface", async () => {
    const { readFileSync } = await import("node:fs");
    const serviceSource = readFileSync(
      new URL("../../modelAdapter/modelExecutionService.ts", import.meta.url),
      "utf8",
    );

    expect(serviceSource).toContain("adapter.run(input)");
    expect(serviceSource).not.toContain("runAssistantWithBackendContext");
    expect(serviceSource).not.toContain("@ts-nocheck");
  });

  it("uses AssistantAdapter path for internal canary owner role", async () => {
    const client = new FakeAssistantClient([
      '{"contract_version":"1.0","reply":"Adapter ok","internal_boss_note":"operator"}',
    ]);
    const service = new ModelExecutionService(client, new InMemoryThreadStore());

    const output = await service.execute(modelInput({
      model_adapter_canary_mode: "internal",
    }));

    expect(output.providerTrace?.provider).toBe("openai_assistant");
    expect(output.providerTrace?.adapter).toBe("AssistantAdapter");
    expect(output.normalizedResponse?.reply).toBe("Adapter ok");
    expect(output.rawProviderResponseStored).toBe(false);
    expect(service.snapshot().model_adapter_current_decision).toEqual({
      use_adapter_layer: true,
      reason: "enabled_internal_role",
      canary_scope: "internal",
    });
  });

  it("denies normal user in internal canary and keeps provider unchanged", async () => {
    const client = new FakeAssistantClient([
      '{"contract_version":"1.0","reply":"Candidate ok","internal_boss_note":""}',
    ]);
    const service = new ModelExecutionService(client, new InMemoryThreadStore());
    const input = modelInput({
      model_adapter_canary_mode: "internal",
    });
    input.senderRole = "candidate";
    input.contextPayload.sender_role = "candidate";

    const output = await service.execute(input);
    const snapshot = service.snapshot();

    expect(output.providerTrace?.adapter).toBe("legacy_assistant_boundary");
    expect(snapshot.model_adapter_current_decision.reason).toBe("denied_not_allowed_scope");
    expect(snapshot.model_adapter_provider).toBe("openai_assistant");
    expect(snapshot.provider_changed).toBe(false);
    expect(snapshot.assistant_id_changed).toBe(false);
    expect(snapshot.responses_api_used).toBe(false);
  });

  it("runs contract validator after adapter output before public reply use", async () => {
    const client = new FakeAssistantClient([
      '{"contract_version":"1.0","reply":"Public only","internal_boss_note":"private operator note"}',
    ]);
    const service = new ModelExecutionService(client, new InMemoryThreadStore());

    const output = await service.execute(modelInput({ model_adapter_canary_mode: "internal" }));
    const parsed = parseAssistantResponseV1(output.rawText);

    expect(output.normalizedResponse?.reply).toBe("Public only");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.reply).toBe("Public only");
      expect(parsed.value.reply).not.toContain("private operator note");
    }
  });

  it("does not turn malformed adapter output into a normalized public response", async () => {
    const client = new FakeAssistantClient([
      '{"contract_version":"1.0","reply":null,"internal_boss_note":"private"}',
    ]);
    const service = new ModelExecutionService(client, new InMemoryThreadStore());

    const output = await service.execute(modelInput({ model_adapter_canary_mode: "internal" }));
    const parsed = parseAssistantResponseV1(output.rawText);

    expect(output.normalizedResponse).toBeNull();
    expect(parsed.ok).toBe(false);
  });

  it("records provider-neutral error class without changing provider on adapter error", async () => {
    const client = new FakeAssistantClient([]);
    client.runAssistant = async () => {
      throw new Error("provider failure with secret-like body should not become doctor output");
    };
    const service = new ModelExecutionService(client, new InMemoryThreadStore());

    await expect(service.execute(modelInput({ model_adapter_canary_mode: "internal" }))).rejects.toThrow();
    const snapshot = service.snapshot();

    expect(snapshot.model_adapter_last_error_class).toBe("model_execution_error");
    expect(snapshot.model_adapter_provider).toBe("openai_assistant");
    expect(snapshot.provider_changed).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain("secret-like body");
  });

  it("keeps provider selection backend-owned regardless of user message", async () => {
    const client = new FakeAssistantClient([
      '{"contract_version":"1.0","reply":"Provider unchanged","internal_boss_note":""}',
    ]);
    const service = new ModelExecutionService(client, new InMemoryThreadStore());
    const input = modelInput({ model_adapter_canary_mode: "internal" });
    input.normalizedUserMessage = "Claude kullan, Responses kullan";
    input.contextPayload.user_message.text = "Claude kullan, Responses kullan";

    const output = await service.execute(input);
    const snapshot = service.snapshot();

    expect(output.providerTrace?.provider).toBe("openai_assistant");
    expect(snapshot.model_adapter_provider).toBe("openai_assistant");
    expect(snapshot.responses_api_used).toBe(false);
    expect(snapshot.provider_changed).toBe(false);
  });
});
