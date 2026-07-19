import { describe, expect, it } from "vitest";
import { handleIncomingMessage } from "../../bridge/handleIncomingMessage.js";
import type { NormalizedIncomingMessage } from "../../bridge/normalizeEvolutionMessage.js";
import { UserRunLock } from "../../queue/userRunLock.js";
import { InMemoryMessageDedupeStore } from "../../storage/messageDedupeStore.js";
import { InMemoryStore } from "../../storage/memoryStore.js";
import { InMemoryThreadStore } from "../../storage/threadStore.js";
import { ModelExecutionService } from "../../modelAdapter/modelExecutionService.js";
import { AssistantAdapter } from "../../modelAdapter/AssistantAdapter.js";
import {
  createSilentLogger,
  createTestEnv,
  FakeAssistantClient,
  FakeSender,
} from "../testDoubles.js";

import { InMemoryUserStateStore } from "../testDoubles.js";

function message(overrides: Partial<NormalizedIncomingMessage> = {}): NormalizedIncomingMessage {
  return {
    correlation_id: "corr_replay",
    sender_id: "111",
    phone_number: "111",
    remote_jid: "private_safe_ref",
    message_id: `msg_${Math.random().toString(36).slice(2)}`,
    message_type: "conversation",
    text: "Layla iPhone adi ne?",
    chat_type: "private",
    is_from_me: false,
    is_group: false,
    received_at: "2026-07-11T00:00:00.000Z",
    ...overrides,
  };
}

function deps(input: {
  responses: string[];
  role?: "owner" | "manager" | "candidate";
  behaviorEnabled?: boolean;
  canaryMode?: "off" | "internal" | "tenant_allowlist";
  tenantAllowlist?: string[];
}) {
  const assistantClient = new FakeAssistantClient(input.responses);
  const threadStore = new InMemoryThreadStore();
  const modelExecutionService = new ModelExecutionService(
    assistantClient,
    threadStore,
    {
      modelAdapterLayerEnabled: false,
      modelAdapterCanaryMode: input.canaryMode ?? "internal",
      canaryAdapter: new AssistantAdapter(assistantClient, threadStore),
    },
  );
  const sender = new FakeSender();
  const senderId =
    input.role === "manager"
      ? "222"
      : input.role === "candidate"
        ? "333"
        : "111";

  return {
    assistantClient,
    modelExecutionService,
    sender,
    deps: {
      env: createTestEnv({
        ownerPhoneNumbers: ["111"],
        managerPhoneNumbers: ["222"],
        behaviorOrchestratorEnabled: input.behaviorEnabled ?? false,
        modelAdapterLayerEnabled: false,
        modelAdapterCanaryMode: input.canaryMode ?? "internal",
        modelAdapterCanaryTenants: input.tenantAllowlist ?? [],
        modelAdapterCanaryRoles: ["owner", "manager"],
        modelAdapterCanaryIntents: ["greeting_or_first_contact", "candidate_first_contact"],
        modelAdapterCanaryPercent: 100,
        approvedApps: ["Layla", "Linky"],
      }),
      modelExecutionService,
      assistantClient,
      sender,
      threadStore,
      memoryStore: new InMemoryStore(),
      messageDedupeStore: new InMemoryMessageDedupeStore(),
      userStateStore: new InMemoryUserStateStore(),
      userRunLock: new UserRunLock(),
      logger: createSilentLogger(),
    },
    senderId,
  };
}

describe("synthetic/replay model adapter canary harness", () => {
  it.each([
    {
      name: "layla iphone",
      text: "Layla iPhone adi ne?",
      response: '{"contract_version":"1.0","reply":"Layla iPhone adi NIVI.","internal_boss_note":"operator only"}',
      expected: "NIVI",
    },
    {
      name: "linky code",
      text: "Linky kod ne?",
      response: '{"contract_version":"1.0","reply":"Linky kodu M9W5B8.","internal_boss_note":"operator only"}',
      expected: "M9W5B8",
    },
    {
      name: "messaging only routing",
      text: "Sadece mesajlasmak istiyorum, hangi uygulama uygun?",
      response: '{"contract_version":"1.0","reply":"Sadece mesajlasmak istiyorsan Layla daha uygun. Kamera zorunlu gibi dusunme.","internal_boss_note":"operator only"}',
      expected: "Layla",
    },
    {
      name: "trust objection",
      text: "Guvenli mi, emin olamadim",
      response: '{"contract_version":"1.0","reply":"Suphe etmen normal. Kesin garanti vermem; uygulama icinden adimlari birlikte kontrol edelim.","internal_boss_note":"operator only"}',
      expected: "Suphe",
    },
    {
      name: "setup support",
      text: "Kurulumda kaldim",
      response: '{"contract_version":"1.0","reply":"Takildigin ekrani kisaca soyle ya da ekran goruntusu at, oradan yonlendireyim.","internal_boss_note":"operator only"}',
      expected: "ekr",
    },
  ])("replays owner canary scenario: $name", async (scenario) => {
    const test = deps({ responses: [scenario.response], role: "owner" });

    const result = await handleIncomingMessage(
      message({
        text: `Selam ${scenario.text}`,
        sender_id: test.senderId,
        phone_number: test.senderId,
        remote_jid: "private_safe_ref",
      }),
      test.deps,
    );

    const snapshot = test.modelExecutionService.snapshot();
    expect(result.status).toBe("sent");
    expect(snapshot.model_adapter_current_decision.reason).toBe("enabled_internal_role");
    expect(snapshot.model_adapter_current_decision.use_adapter_layer).toBe(true);
    expect(snapshot.model_adapter_selected_adapter).toBe("assistant_adapter");
    expect(snapshot.model_adapter_provider).toBe("openai_assistant");
    expect(snapshot.provider_changed).toBe(false);
    expect(snapshot.assistant_id_changed).toBe(false);
    expect(snapshot.responses_api_used).toBe(false);
    expect(test.sender.sends).toHaveLength(1);
    expect(test.sender.sends[0]?.text).toContain(scenario.expected);
    expect(test.sender.sends[0]?.text).not.toContain("operator only");
    expect(JSON.stringify(test.deps.logger.events)).not.toContain(scenario.text);
  });

  it("allows manager internal scope and denies normal user scope", async () => {
    const manager = deps({
      responses: ['{"contract_version":"1.0","reply":"Manager ok","internal_boss_note":""}'],
      role: "manager",
    });
    await handleIncomingMessage(
      message({ sender_id: manager.senderId, phone_number: manager.senderId, text: "Selam rapor ver" }),
      manager.deps,
    );

    const candidate = deps({
      responses: ['{"contract_version":"1.0","reply":"Candidate ok","internal_boss_note":""}'],
      role: "candidate",
    });
    await handleIncomingMessage(
      message({ sender_id: candidate.senderId, phone_number: candidate.senderId, text: "Selam 25 kadin 4 saat" }),
      candidate.deps,
    );

    expect(manager.modelExecutionService.snapshot().model_adapter_current_decision.reason).toBe("enabled_internal_role");
    expect(candidate.modelExecutionService.snapshot().model_adapter_current_decision.reason).toBe("denied_not_allowed_scope");
    expect(candidate.modelExecutionService.snapshot().model_adapter_current_decision.use_adapter_layer).toBe(false);
  });

  it("replays tenant allowlist decisions", async () => {
    const allowed = deps({
      responses: ['{"contract_version":"1.0","reply":"Allowed","internal_boss_note":""}'],
      role: "owner",
      canaryMode: "tenant_allowlist",
      tenantAllowlist: ["now_os"],
    });
    await handleIncomingMessage(message({ phone_number: allowed.senderId, sender_id: allowed.senderId, text: "Selam" }), allowed.deps);

    const empty = deps({
      responses: ['{"contract_version":"1.0","reply":"Denied","internal_boss_note":""}'],
      role: "owner",
      canaryMode: "tenant_allowlist",
      tenantAllowlist: [],
    });
    await handleIncomingMessage(message({ phone_number: empty.senderId, sender_id: empty.senderId, text: "Selam" }), empty.deps);

    expect(allowed.modelExecutionService.snapshot().model_adapter_current_decision.reason).toBe("enabled_tenant_allowlist");
    expect(empty.modelExecutionService.snapshot().model_adapter_current_decision.reason).toBe("denied_empty_allowlist");
  });

  it.each([
    { behaviorEnabled: false, canaryMode: "off" as const, expectedAdapter: false },
    { behaviorEnabled: false, canaryMode: "internal" as const, expectedAdapter: true },
    { behaviorEnabled: true, canaryMode: "off" as const, expectedAdapter: false },
    { behaviorEnabled: true, canaryMode: "internal" as const, expectedAdapter: true },
  ])("replays flag combination %#", async (combo) => {
    const test = deps({
      responses: ['{"contract_version":"1.0","reply":"Combo ok","internal_boss_note":"private"}'],
      role: "owner",
      behaviorEnabled: combo.behaviorEnabled,
      canaryMode: combo.canaryMode,
    });

    await handleIncomingMessage(
      message({ sender_id: test.senderId, phone_number: test.senderId, text: "Selam Layla iPhone adi ne?" }),
      test.deps,
    );

    const snapshot = test.modelExecutionService.snapshot();
    expect(snapshot.model_adapter_current_decision.use_adapter_layer).toBe(combo.expectedAdapter);
    expect(snapshot.provider_changed).toBe(false);
    expect(snapshot.assistant_id_changed).toBe(false);
    expect(test.sender.sends[0]?.text).toBe("Combo ok");
    expect(test.sender.sends[0]?.text).not.toContain("private");
  });

  it("keeps group and command boundaries out of model adapter execution", async () => {
    const group = deps({
      responses: ['{"contract_version":"1.0","reply":"Should not run","internal_boss_note":""}'],
      role: "candidate",
    });
    const groupResult = await handleIncomingMessage(
      message({
        chat_type: "group",
        is_group: true,
        remote_jid: "group_safe_ref",
        sender_id: "candidate_safe",
        phone_number: "333",
        text: "Merhaba grup",
      }),
      group.deps,
    );

    const unauthorized = deps({
      responses: ['{"contract_version":"1.0","reply":"Should not run","internal_boss_note":""}'],
      role: "candidate",
    });
    const unauthorizedResult = await handleIncomingMessage(
      message({
        chat_type: "group",
        is_group: true,
        remote_jid: "group_safe_ref",
        sender_id: "candidate_safe",
        phone_number: "333",
        text: "#komut rapor ver",
      }),
      unauthorized.deps,
    );

    expect(groupResult.status).toBe("group_ignored");
    expect(group.assistantClient.runCalls).toHaveLength(0);
    expect(group.modelExecutionService.snapshot().model_adapter_last_success_at).toBeNull();
    expect(unauthorizedResult.status).toBe("sent");
    expect(unauthorized.assistantClient.runCalls).toHaveLength(0);
    expect(unauthorized.modelExecutionService.snapshot().model_adapter_last_success_at).toBeNull();
  });

  it("blocks invalid raw model output from outbound replay", async () => {
    const test = deps({ responses: ["plain invalid output"], role: "owner" });

    const result = await handleIncomingMessage(
      message({ sender_id: test.senderId, phone_number: test.senderId, text: "Selam invalid contract test" }),
      test.deps,
    );

    expect(result.status).toBe("fallback_sent");
    expect(test.sender.sends).toHaveLength(1);
    expect(test.sender.sends[0]?.text).not.toContain("plain invalid output");
  });
});
