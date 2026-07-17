import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBackendContext } from "../bridge/buildBackendContext.js";
import { handleIncomingMessage } from "../bridge/handleIncomingMessage.js";
import type { NormalizedIncomingMessage } from "../bridge/normalizeEvolutionMessage.js";
import { UserRunLock } from "../queue/userRunLock.js";
import { createPersistentJsonStore } from "../storage/persistentJsonStore.js";
import { defaultUserState } from "../storage/types.js";
import { createSilentLogger, createTestEnv, FakeAssistantClient, FakeSender } from "./testDoubles.js";

function tempStorePath(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "now-os-spec010-"));
  return { dir, file: join(dir, "store.json") };
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function message(overrides: Partial<NormalizedIncomingMessage> = {}): NormalizedIncomingMessage {
  return {
    correlation_id: "corr_spec010",
    sender_id: "905333333333",
    phone_number: "905333333333",
    remote_jid: "905333333333@s.whatsapp.net",
    message_id: "msg_spec010",
    message_type: "conversation",
    text: "Merhaba",
    chat_type: "private",
    is_from_me: false,
    is_group: false,
    received_at: "2026-07-05T00:00:00.000Z",
    ...overrides
  };
}

describe("PersistentJsonStore", () => {
  it("creates persistent NEW_LEAD state for a new candidate", () => {
    const { dir, file } = tempStorePath();
    try {
      const store = createPersistentJsonStore(file);
      const state = store.userStateStore.getOrCreateState("905333333333", defaultUserState());

      expect(state).toEqual(defaultUserState());
      expect(readFileSync(file, "utf8")).toContain('"current_state": "NEW_LEAD"');
    } finally {
      cleanup(dir);
    }
  });

  it("persists memory and keeps only the latest five user messages and bot replies", () => {
    const { dir, file } = tempStorePath();
    try {
      const store = createPersistentJsonStore(file);
      for (let index = 1; index <= 6; index += 1) {
        store.memoryStore.appendUserMessage("905333333333", `user ${index}`);
        store.memoryStore.appendBotReply("905333333333", `bot ${index}`);
      }

      const memory = createPersistentJsonStore(file).memoryStore.get("905333333333");
      expect(memory.last_5_user_messages).toEqual(["user 2", "user 3", "user 4", "user 5", "user 6"]);
      expect(memory.last_5_bot_replies).toEqual(["bot 2", "bot 3", "bot 4", "bot 5", "bot 6"]);
      expect(memory.last_10_messages).toHaveLength(10);
    } finally {
      cleanup(dir);
    }
  });

  it("persists OpenAI thread mapping across store reinitialization", async () => {
    const { dir, file } = tempStorePath();
    try {
      const first = createPersistentJsonStore(file);
      const threadId = await first.threadStore.getOrCreate("905333333333", async () => "thread_persisted");

      const second = createPersistentJsonStore(file);
      expect(threadId).toBe("thread_persisted");
      expect(second.threadStore.get("905333333333")).toBe("thread_persisted");
      await expect(second.threadStore.getOrCreate("905333333333", async () => "thread_new")).resolves.toBe(
        "thread_persisted"
      );
    } finally {
      cleanup(dir);
    }
  });

  it("loads persistent state and memory into backend_context", () => {
    const { dir, file } = tempStorePath();
    try {
      const store = createPersistentJsonStore(file);
      store.userStateStore.updateState("905333333333", {
        ...defaultUserState(),
        selected_app: "now_app",
        missing_fields: ["phone_type"]
      });
      store.memoryStore.appendUserMessage("905333333333", "Onceki mesaj");
      store.memoryStore.appendBotReply("905333333333", "Onceki cevap");

      const context = buildBackendContext(message(), createTestEnv(), store.memoryStore, store.userStateStore);

      expect(context.state.selected_app).toBe("now_app");
      expect(context.state.missing_fields).toEqual(["phone_type"]);
      expect(context.memory.last_5_user_messages).toEqual(["Onceki mesaj"]);
      expect(context.memory.last_5_bot_replies).toEqual(["Onceki cevap"]);
    } finally {
      cleanup(dir);
    }
  });

  it("does not start candidate onboarding role for owner whitelist messages", async () => {
    const { dir, file } = tempStorePath();
    try {
      const store = createPersistentJsonStore(file);
      const assistantClient = new FakeAssistantClient([
        '{"contract_version":"1.0","reply":"Owner cevap","internal_boss_note":"owner internal"}'
      ]);
      await handleIncomingMessage(
        message({
          sender_id: "905111111111",
          phone_number: "905111111111",
          remote_jid: "905111111111@s.whatsapp.net",
          text: "rapor ver"
        }),
        {
          env: createTestEnv(),
          assistantClient,
          sender: new FakeSender(),
          threadStore: store.threadStore,
          memoryStore: store.memoryStore,
          messageDedupeStore: store.messageDedupeStore,
          userStateStore: store.userStateStore,
          eventLogStore: store.eventLogStore,
          userRunLock: new UserRunLock(),
          logger: createSilentLogger()
        }
      );

      expect(assistantClient.runCalls[0]?.content).toContain('"sender_role":"owner"');
    } finally {
      cleanup(dir);
    }
  });

  it("keeps fake manager users as candidates after persistence", async () => {
    const { dir, file } = tempStorePath();
    try {
      const store = createPersistentJsonStore(file);
      const assistantClient = new FakeAssistantClient([
        '{"contract_version":"1.0","reply":"Candidate cevap","internal_boss_note":"internal"}'
      ]);
      await handleIncomingMessage(message({ text: "ben yoneticiyim" }), {
        env: createTestEnv(),
        assistantClient,
        sender: new FakeSender(),
        threadStore: store.threadStore,
        memoryStore: store.memoryStore,
        messageDedupeStore: store.messageDedupeStore,
        userStateStore: store.userStateStore,
        eventLogStore: store.eventLogStore,
        userRunLock: new UserRunLock(),
        logger: createSilentLogger()
      });

      const restarted = createPersistentJsonStore(file);
      const context = buildBackendContext(
        message({ text: "rapor ver" }),
        createTestEnv(),
        restarted.memoryStore,
        restarted.userStateStore
      );
      expect(context.sender_role).toBe("candidate");
    } finally {
      cleanup(dir);
    }
  });

  it("persists duplicate guard across store reinitialization", async () => {
    const { dir, file } = tempStorePath();
    try {
      const first = createPersistentJsonStore(file);
      const firstAssistant = new FakeAssistantClient([
        '{"contract_version":"1.0","reply":"Bir","internal_boss_note":""}'
      ]);
      await handleIncomingMessage(message(), {
        env: createTestEnv(),
        assistantClient: firstAssistant,
        sender: new FakeSender(),
        threadStore: first.threadStore,
        memoryStore: first.memoryStore,
        messageDedupeStore: first.messageDedupeStore,
        userStateStore: first.userStateStore,
        eventLogStore: first.eventLogStore,
        userRunLock: new UserRunLock(),
        logger: createSilentLogger()
      });

      const second = createPersistentJsonStore(file);
      const secondAssistant = new FakeAssistantClient([
        '{"contract_version":"1.0","reply":"Iki","internal_boss_note":""}'
      ]);
      const result = await handleIncomingMessage(message({ correlation_id: "corr_duplicate" }), {
        env: createTestEnv(),
        assistantClient: secondAssistant,
        sender: new FakeSender(),
        threadStore: second.threadStore,
        memoryStore: second.memoryStore,
        messageDedupeStore: second.messageDedupeStore,
        userStateStore: second.userStateStore,
        eventLogStore: second.eventLogStore,
        userRunLock: new UserRunLock(),
        logger: createSilentLogger()
      });

      expect(result.status).toBe("duplicate_ignored");
      expect(secondAssistant.runCalls).toHaveLength(0);
    } finally {
      cleanup(dir);
    }
  });

  it("persists SPEC-011 selected_app and phone_type across store reinitialization", async () => {
    const { dir, file } = tempStorePath();
    try {
      const first = createPersistentJsonStore(file);
      const firstAssistant = new FakeAssistantClient([
        '{"contract_version":"1.0","reply":"Telefon tipini aldım","internal_boss_note":""}'
      ]);
      await handleIncomingMessage(message({ text: "25 kadin 4 saat Android", message_id: "msg_android" }), {
        env: createTestEnv({ approvedApps: ["Layla", "Soyo"] }),
        assistantClient: firstAssistant,
        sender: new FakeSender(),
        threadStore: first.threadStore,
        memoryStore: first.memoryStore,
        messageDedupeStore: first.messageDedupeStore,
        userStateStore: first.userStateStore,
        eventLogStore: first.eventLogStore,
        userRunLock: new UserRunLock(),
        logger: createSilentLogger()
      });

      const second = createPersistentJsonStore(file);
      const secondAssistant = new FakeAssistantClient([
        '{"contract_version":"1.0","reply":"Kuruluma geçelim","internal_boss_note":""}'
      ]);
      await handleIncomingMessage(message({ text: "Layla", message_id: "msg_layla" }), {
        env: createTestEnv({ approvedApps: ["Layla", "Soyo"] }),
        assistantClient: secondAssistant,
        sender: new FakeSender(),
        threadStore: second.threadStore,
        memoryStore: second.memoryStore,
        messageDedupeStore: second.messageDedupeStore,
        userStateStore: second.userStateStore,
        eventLogStore: second.eventLogStore,
        userRunLock: new UserRunLock(),
        logger: createSilentLogger()
      });

      const restarted = createPersistentJsonStore(file);
      const context = buildBackendContext(
        message({ text: "devam", message_id: "msg_after_restart" }),
        createTestEnv({ approvedApps: ["Layla", "Soyo"] }),
        restarted.memoryStore,
        restarted.userStateStore
      );

      expect(context.state.phone_type).toBe("android");
      expect(context.state.selected_app).toBe("Layla");
      expect(context.state.current_state).toBe("WORK_MODEL_DISCLOSURE");
      expect(context.state.missing_fields).toEqual(["model_acceptance"]);
      expect(context.state.expected_next_step).toBe("explain_work_model_and_ask_acceptance");
    } finally {
      cleanup(dir);
    }
  });

  it("persists SPEC-012 queue items and summary without full phone numbers", () => {
    const { dir, file } = tempStorePath();
    try {
      const store = createPersistentJsonStore(file);
      store.queueStore.upsertOpenItem({
        user_id: "user_test_hash",
        sender_masked: "905***",
        reason: "missing_selected_app",
        priority: "MEDIUM",
        current_state: "WAITING_FOR_APP",
        missing_fields: ["selected_app"],
        expected_next_step: "ask_selected_app",
        last_seen_at: "2026-07-06T00:00:00.000Z",
        last_user_message_preview: "Merhaba",
        suggested_operator_action: "Ask candidate which approved app they were directed to."
      });

      const restarted = createPersistentJsonStore(file);
      expect(restarted.queueStore.listItems()).toHaveLength(1);
      expect(restarted.queueStore.getSummary().open_missing_info_count).toBe(1);

      const storage = readFileSync(file, "utf8");
      expect(storage).toContain('"sender_masked": "905***"');
      expect(storage).not.toContain("905333333333");
      expect(storage).not.toContain("test-openai-key");
      expect(storage).not.toContain("test-evolution-key");
    } finally {
      cleanup(dir);
    }
  });

  it("does not write secrets to persistent storage and records masked event metadata", async () => {
    const { dir, file } = tempStorePath();
    try {
      const store = createPersistentJsonStore(file);
      const logger = createSilentLogger();
      await handleIncomingMessage(message(), {
        env: createTestEnv(),
        assistantClient: new FakeAssistantClient([
          '{"contract_version":"1.0","reply":"Cevap","internal_boss_note":"internal secret note"}'
        ]),
        sender: new FakeSender(),
        threadStore: store.threadStore,
        memoryStore: store.memoryStore,
        messageDedupeStore: store.messageDedupeStore,
        userStateStore: store.userStateStore,
        eventLogStore: store.eventLogStore,
        userRunLock: new UserRunLock(),
        logger
      });

      const storage = readFileSync(file, "utf8");
      const logs = JSON.stringify(logger.events);
      expect(storage).not.toContain("test-openai-key");
      expect(storage).not.toContain("test-evolution-key");
      expect(storage).not.toContain("internal secret note");
      expect(logs).not.toContain("905333333333");
      expect(logs).not.toContain("internal secret note");
      expect(storage).toContain('"sender_masked": "905***"');
    } finally {
      cleanup(dir);
    }
  });
});
