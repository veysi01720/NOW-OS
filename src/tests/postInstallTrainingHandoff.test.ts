import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleIncomingMessage } from "../bridge/handleIncomingMessage.js";
import type { NormalizedIncomingMessage } from "../bridge/normalizeEvolutionMessage.js";
import { UserRunLock } from "../queue/userRunLock.js";
import { InMemoryStore } from "../storage/memoryStore.js";
import { InMemoryMessageDedupeStore } from "../storage/messageDedupeStore.js";
import { InMemoryThreadStore } from "../storage/threadStore.js";
import { defaultUserState } from "../storage/types.js";
import { PersistentHumanHandoffStore } from "../store/humanHandoffStore.js";
import { createSilentLogger, createTestEnv, FakeAssistantClient, FakeSender, InMemoryUserStateStore } from "./testDoubles.js";
import { PersistentTrainingHandoffStore, trainingOwnerDecision } from "../store/trainingHandoffStore.js";

function candidateMessage(): NormalizedIncomingMessage {
  return {
    correlation_id: "training-gate-integration",
    sender_id: "905000000000",
    phone_number: "905000000000",
    remote_jid: "905000000000@s.whatsapp.net",
    message_id: "training-gate-message",
    message_type: "conversation",
    text: "Kurulum tamamlandi",
    chat_type: "private",
    is_from_me: false,
    is_group: false,
    received_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("post-install training owner gate", () => {
  it("creates the training gate after installation and sends one candidate reply plus one owner notification", async () => {
    const root = mkdtempSync(join(tmpdir(), "training-gate-integration-"));
    const stateStore = new InMemoryUserStateStore();
    stateStore.states.set("905000000000", {
      ...defaultUserState(),
      current_state: "INSTALLATION_IN_PROGRESS",
      age: 27,
      gender: "erkek",
      daily_hours: 4,
      eligibility_status: "eligible",
      selected_app: "Layla",
      phone_type: "android",
      work_model_disclosed: true,
      model_acceptance: "accepted",
      installation_status: "done",
      training_status: "not_started",
      missing_fields: [],
      expected_next_step: "continue_installation",
    });
    const sender = new FakeSender();
    const trainingHandoffStore = new PersistentTrainingHandoffStore(join(root, "training-handoffs.json"));
    const humanHandoffStore = new PersistentHumanHandoffStore(join(root, "human-handoffs.json"));

    await handleIncomingMessage(candidateMessage(), {
      env: createTestEnv({ ownerPhoneNumbers: ["905111111111"] }),
      assistantClient: new FakeAssistantClient([]),
      sender,
      threadStore: new InMemoryThreadStore(),
      memoryStore: new InMemoryStore(),
      messageDedupeStore: new InMemoryMessageDedupeStore(),
      userStateStore: stateStore,
      trainingHandoffStore,
      humanHandoffStore,
      userRunLock: new UserRunLock(),
      logger: createSilentLogger(),
    });

    expect(stateStore.states.get("905000000000")?.current_state).toBe("TRAINING_READY");
    expect(trainingHandoffStore.pending()).toHaveLength(1);
    expect(trainingHandoffStore.pending()[0]?.reason_code).toBe("post_install_training_gate");
    expect(humanHandoffStore.list()).toHaveLength(1);
    expect(humanHandoffStore.list()[0]?.reason_code).toBe("post_install_training_gate");
    expect(sender.sends.filter((item) => item.message.phone_number === "905000000000")).toHaveLength(1);
    expect(sender.sends.filter((item) => item.message.phone_number === "905111111111")).toHaveLength(1);
    rmSync(root, { recursive: true, force: true });
  });

  it("stays pending indefinitely when the owner does not answer", () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const store = new PersistentTrainingHandoffStore(join(mkdtempSync(join(tmpdir(), "training-gate-")), "gates.json"), () => now);
    const created = store.create({ tenant_id: "now_os", conversation_key: "candidate-key", candidate_phone: "905000000000", candidate_remote_jid: "905000000000@s.whatsapp.net", selected_app: "Layla" });
    now = new Date("2026-02-15T00:00:00.000Z");
    expect(store.pending()).toHaveLength(1);
    expect(store.stats().reminder_due_count).toBe(1);
    expect(created.record.status).toBe("pending_owner_approval");
  });

  it("parses only deterministic owner decisions", () => {
    expect(trainingOwnerDecision("evet eğitime geç")).toEqual({ kind: "yes" });
    expect(trainingOwnerDecision("hayır 905551112233")).toEqual({ kind: "redirect", number: "905551112233" });
    expect(trainingOwnerDecision("belki sonra")).toBeNull();
  });
});
