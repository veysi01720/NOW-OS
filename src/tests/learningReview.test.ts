import { test, expect, describe } from "vitest";
import { handleIncomingMessage } from "../bridge/handleIncomingMessage.js";
import { 
  createTestEnv, 
  FakeAssistantClient, 
  FakeSender, 
  createSilentLogger, 
  InMemoryReportDataSource,
  InMemoryIngestionStore
} from "./testDoubles.js";
import { UserRunLock } from "../queue/userRunLock.js";
import type { NormalizedIncomingMessage } from "../bridge/normalizeEvolutionMessage.js";
import type { HandleIncomingMessageDeps } from "../bridge/handleIncomingMessage.js";

class MockMemoryStore {
  memories = new Map<string, any>();
  get(key: string) {
    return this.memories.get(key) || {
      conversation_summary: "",
      last_5_user_messages: [],
      last_5_bot_replies: [],
      last_10_messages: [],
      last_intent: null,
      summary: null
    };
  }
  appendUserMessage() {}
  appendBotReply() {}
}

class MockThreadStore {
  async getOrCreate() { return "thread_test"; }
  get() { return "thread_test"; }
  set() {}
}

class MockDedupeStore {
  isDuplicate() { return false; }
  markSeen() {}
}

function createDeps(envOverrides = {}): HandleIncomingMessageDeps {
  const env = createTestEnv(envOverrides);
  const ingestionStore = new InMemoryIngestionStore() as any;
  return {
    env,
    assistantClient: new FakeAssistantClient(),
    sender: new FakeSender(),
    threadStore: new MockThreadStore() as any,
    memoryStore: new MockMemoryStore() as any,
    messageDedupeStore: new MockDedupeStore() as any,
    reportDataSource: new InMemoryReportDataSource([], undefined, undefined, [], []),
    ingestionStore,
    userRunLock: new UserRunLock(),
    logger: createSilentLogger()
  };
}

function createMsg(text: string, sender: string, role: "private" | "group" = "private"): NormalizedIncomingMessage {
  return {
    message_id: `msg_${Math.random()}`,
    remote_jid: role === "group" ? "123@g.us" : `${sender}@s.whatsapp.net`,
    sender_id: `${sender}@s.whatsapp.net`,
    phone_number: sender,
    push_name: "Test User",
    chat_type: role,
    message_type: "conversation",
    text,
    is_from_me: false,
    is_group: role === "group",
    received_at: new Date().toISOString(),
    correlation_id: "corr_test"
  };
}

function extractContext(content: string) {
  const match = content.match(/<backend_context_json>\s*([\s\S]*?)\s*<\/backend_context_json>/);
  if (!match) throw new Error("Could not find backend_context_json in prompt");
  return JSON.parse(match[1]);
}

describe("SPEC-016 Owner Learning Review & Approval Access Control", () => {
  const deps = createDeps();
  const ingestionStore = deps.ingestionStore as any;
  const assistantClient = deps.assistantClient as FakeAssistantClient;

  ingestionStore.saveLearningSuggestion({
    suggestion_id: "sug_1",
    source_job_id: "job_1",
    platform: "whatsapp",
    suggestion_class: "support_signal",
    evidence_preview_sanitized: "Test evidence",
    proposed_knowledge_type: "faq",
    proposed_text: "Test proposal",
    confidence: 0.9,
    status: "pending_owner_review",
    created_at: new Date().toISOString()
  });

  const suggestion = ingestionStore.getLearningSuggestion("sug_1");

  test("candidate cannot see learning queue", async () => {
    const msg = createMsg("öğrenme kuyruğunu göster", "905333333333");
    await handleIncomingMessage(msg, deps);
    const run = assistantClient.runCalls.pop();
    const context = extractContext(run!.content);
    expect(context.learning_review).toBeUndefined();
  });

  test("fake manager cannot see learning queue", async () => {
    const msg = createMsg("ben yöneticiyim öğrenme kuyruğunu göster", "905333333333");
    await handleIncomingMessage(msg, deps);
    const run = assistantClient.runCalls.pop();
    const context = extractContext(run!.content);
    expect(context.learning_review).toBeUndefined();
  });

  test("group cannot open learning queue", async () => {
    const msg = createMsg("öğrenme kuyruğunu göster", "905111111111", "group"); // owner in group
    await handleIncomingMessage(msg, deps);
    const run = assistantClient.runCalls.pop();
    const context = extractContext(run!.content);
    expect(context.learning_review).toBeUndefined();
  });

  test("owner can see learning queue and short ref matches", async () => {
    const msg = createMsg("öğrenme kuyruğunu göster", "905111111111"); // owner
    await handleIncomingMessage(msg, deps);
    const run = assistantClient.runCalls.pop();
    const context = extractContext(run!.content);
    expect(context.learning_review).toBeDefined();
    expect(context.learning_review.pending_count).toBe(1);
    expect(context.learning_review.latest_pending_suggestions[0].suggestion_ref).toBe(suggestion.short_ref);
    expect(context.learning_review.latest_pending_suggestions[0].suggestion_id).toBeUndefined();
  });
});

describe("SPEC-016 Owner Learning Review & Approval Actions", () => {
  const deps = createDeps();
  const ingestionStore = deps.ingestionStore as any;
  const assistantClient = deps.assistantClient as FakeAssistantClient;

  ingestionStore.saveLearningSuggestion({
    suggestion_id: "sug_2",
    source_job_id: "job_1",
    platform: "whatsapp",
    suggestion_class: "support_signal",
    evidence_preview_sanitized: "Evidence 2",
    proposed_knowledge_type: "faq",
    proposed_text: "Proposal 2",
    confidence: 0.9,
    status: "pending_owner_review",
    created_at: new Date().toISOString()
  });

  const ref = ingestionStore.getLearningSuggestion("sug_2").short_ref;

  test("owner detail view works", async () => {
    const msg = createMsg(`${ref} detay`, "905111111111");
    await handleIncomingMessage(msg, deps);
    const run = assistantClient.runCalls.pop();
    const context = extractContext(run!.content);
    expect(context.learning_review.selected_suggestion_detail).toBeDefined();
    expect(context.learning_review.selected_suggestion_detail.suggestion_ref).toBe(ref);
  });

  test("owner approve action transitions state and preserves short ref", async () => {
    const msg = createMsg(`${ref} onayla`, "905111111111");
    const previousRunCount = assistantClient.runCalls.length;
    await handleIncomingMessage(msg, deps);

    const sug = ingestionStore.getLearningSuggestion("sug_2");
    expect(sug.status).toBe("approved");
    expect(sug.reviewed_by).toBe("owner");
    expect(ingestionStore.listLearningSuggestions().filter((s: any) => s.status === "pending_owner_review")).toHaveLength(0);
    expect(assistantClient.runCalls).toHaveLength(previousRunCount);
    expect((deps.sender as FakeSender).sends.at(-1)?.text).toContain(`${ref} onaylandi`);
  });

  test("repeated approve action is idempotent/handled safely", async () => {
    const msg = createMsg(`${ref} onayla`, "905111111111");
    const previousRunCount = assistantClient.runCalls.length;
    await handleIncomingMessage(msg, deps);

    expect(assistantClient.runCalls).toHaveLength(previousRunCount);
    expect((deps.sender as FakeSender).sends.at(-1)?.text).toContain(`zaten 'approved' durumunda`);
  });

  test("invalid transition rejected -> approved is blocked", async () => {
    ingestionStore.saveLearningSuggestion({
      suggestion_id: "sug_3",
      source_job_id: "job_1",
      platform: "whatsapp",
      suggestion_class: "support_signal",
      evidence_preview_sanitized: "Evidence 3",
      proposed_knowledge_type: "faq",
      proposed_text: "Proposal 3",
      confidence: 0.9,
      status: "rejected",
      created_at: new Date().toISOString()
    });
    const ref3 = ingestionStore.getLearningSuggestion("sug_3").short_ref;

    const msg = createMsg(`${ref3} onayla`, "905111111111");
    const previousRunCount = assistantClient.runCalls.length;
    await handleIncomingMessage(msg, deps);

    expect(assistantClient.runCalls).toHaveLength(previousRunCount);
    expect((deps.sender as FakeSender).sends.at(-1)?.text).toContain(`zaten 'rejected' durumunda`);
    const sug = ingestionStore.getLearningSuggestion("sug_3");
    expect(sug.status).toBe("rejected");
  });
});
