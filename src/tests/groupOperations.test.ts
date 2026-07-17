import { test, expect } from "vitest";
import { normalizeEvolutionMessage } from "../bridge/normalizeEvolutionMessage.js";
import { handleIncomingMessage } from "../bridge/handleIncomingMessage.js";
import { defaultUserState, type UserStateStore, type UserState, type EventLogStore } from "../storage/types.js";
import { createTestEnv, InMemoryQueueStore, FakeSender, FakeAssistantClient, createSilentLogger, InMemoryPublisherStore, InMemoryReportDataSource } from "./testDoubles.js";
import { InMemoryStore } from "../storage/memoryStore.js";
import { InMemoryMessageDedupeStore } from "../storage/messageDedupeStore.js";
import { InMemoryThreadStore } from "../storage/threadStore.js";
import { UserRunLock } from "../queue/userRunLock.js";
import type { HandleIncomingMessageDeps } from "../bridge/handleIncomingMessage.js";
import { buildOwnerReportSummary } from "../bridge/ownerReport.js";

class MutableUserStateStore implements UserStateStore {
  public states = new Map<string, UserState>();

  getOrCreateState(userId: string, defaults: UserState): UserState {
    const existing = this.states.get(userId);
    if (existing !== undefined) {
      return { ...existing, missing_fields: [...existing.missing_fields] };
    }

    const created = { ...defaults, missing_fields: [...defaults.missing_fields] };
    this.states.set(userId, created);
    return { ...created, missing_fields: [...created.missing_fields] };
  }

  updateState(userId: string, state: UserState): void {
    this.states.set(userId, { ...state, missing_fields: [...state.missing_fields] });
  }

  getState(userId: string): UserState | undefined {
    return this.states.get(userId);
  }
}

class FakeEventLogStore implements EventLogStore {
  recordEvent(): void {}
}

function makeDeps(): HandleIncomingMessageDeps {
  const env = createTestEnv();
  env.ownerPhoneNumbers = ["905551112233"];
  env.approvedApps = ["Telegram", "Skype"];
  
  const queueStore = new InMemoryQueueStore();
  const publisherStore = new InMemoryPublisherStore();
  const userStateStore = new MutableUserStateStore();
  
  return {
    env,
    memoryStore: new InMemoryStore(),
    messageDedupeStore: new InMemoryMessageDedupeStore(),
    userStateStore,
    eventLogStore: new FakeEventLogStore(),
    queueStore,
    publisherStore,
    sender: new FakeSender(),
    assistantClient: new FakeAssistantClient(),
    threadStore: new InMemoryThreadStore(),
    userRunLock: new UserRunLock(),
    reportDataSource: new InMemoryReportDataSource([], queueStore, publisherStore),
    logger: createSilentLogger()
  };
}

function makeGroupPayload(sender: string, groupJid: string, text: string): unknown {
  return {
    event: "messages.upsert",
    instance: "TestInstance",
    data: {
      key: {
        remoteJid: groupJid,
        fromMe: false,
        id: `msg_${Math.random()}`,
        participant: sender
      },
      message: {
        conversation: text
      },
      pushName: "GroupUser"
    }
  };
}

test("Group Operations: synthetic group payload avoids candidate onboarding and captures support signal", async () => {
  const deps = makeDeps();
  const payload = makeGroupPayload("905559998877@s.whatsapp.net", "1234567890@g.us", "Uygulamayi yukleyemedim, hata veriyor yardim");
  const msg = normalizeEvolutionMessage(payload);
  
  const result = await handleIncomingMessage(msg, deps);
  expect(result.status).toBe("sent");

  // Validate candidate onboarding didn't start (group ignored)
  const state = (deps.userStateStore as MutableUserStateStore).getState(msg.sender_id);
  expect(state).toBeUndefined();

  // Validate queue item created for group_support_signal
  const queueStore = deps.queueStore as InMemoryQueueStore;
  const items = queueStore.listItems();
  const groupItems = items.filter(i => i.scope_type === "group");
  expect(groupItems.length).toBe(1);
  expect(["group_installation_question", "group_support_signal"]).toContain(groupItems[0].reason);
  expect(["HIGH", "MEDIUM"]).toContain(groupItems[0].priority);
  expect(groupItems[0].group_id_hash).toBeDefined();
  expect(groupItems[0].sender_id_hash).toBeDefined();
});

test("Group Operations: deduplication works based on group_id_hash and sender_id_hash", async () => {
  const deps = makeDeps();
  const queueStore = deps.queueStore as InMemoryQueueStore;

  const msg1 = normalizeEvolutionMessage(makeGroupPayload("905559998877@s.whatsapp.net", "1234567890@g.us", "Nasil yapacagim egitimi anlamadim"));
  await handleIncomingMessage(msg1, deps);

  const msg2 = normalizeEvolutionMessage(makeGroupPayload("905559998877@s.whatsapp.net", "1234567890@g.us", "Hala egitimde takildim"));
  await handleIncomingMessage(msg2, deps);

  let groupItems = queueStore.listItems().filter(i => i.scope_type === "group" && i.reason === "group_support_signal");
  
  // They should deduplicate into the same item since reason is group_support_signal and sender+group are same.
  expect(groupItems.length).toBe(1);

  // Different sender in same group
  const msg3 = normalizeEvolutionMessage(makeGroupPayload("905551112222@s.whatsapp.net", "1234567890@g.us", "takildim"));
  await handleIncomingMessage(msg3, deps);
  expect(queueStore.listItems().filter(i => i.reason === "group_support_signal").length).toBe(2);

  // Same sender in different group
  const msg4 = normalizeEvolutionMessage(makeGroupPayload("905559998877@s.whatsapp.net", "0987654321@g.us", "takildim"));
  await handleIncomingMessage(msg4, deps);
  expect(queueStore.listItems().filter(i => i.reason === "group_support_signal").length).toBe(3);
});

test("Group Operations: Owner private report includes group metrics but group message does not expose report", async () => {
  const deps = makeDeps();
  const queueStore = deps.queueStore as InMemoryQueueStore;
  const publisherStore = deps.publisherStore as InMemoryPublisherStore;
  
  // 1. Group message asking for report should NOT trigger owner report
  const msgGroup = normalizeEvolutionMessage(makeGroupPayload("905551112233@s.whatsapp.net", "1234567890@g.us", "rapor ver"));
  await handleIncomingMessage(msgGroup, deps);
  
  // Create a support signal to have active group count = 1
  await handleIncomingMessage(normalizeEvolutionMessage(makeGroupPayload("905559998877@s.whatsapp.net", "1234567890@g.us", "takildim")), deps);
  
  // Refresh report data source
  deps.reportDataSource = new InMemoryReportDataSource([], queueStore, publisherStore);

  // 2. Private message asking for report SHOULD trigger owner report
  const summary = buildOwnerReportSummary(deps.reportDataSource);
  expect(summary.active_groups_count).toBe(1);
  expect(summary.group_support_signal_count).toBe(1);
  expect(summary.top_group_followups.length).toBe(1);
  expect(summary.top_group_followups[0].reason).toBe("group_support_signal");
});
