import { describe, it, expect } from "vitest";
import { enqueueInboundShadow } from "../reliability/shadowQueue.js";
import { InMemoryReliabilityQueueStore } from "../reliability/inMemoryReliabilityQueueStore.js";
import type { NormalizedIncomingMessage } from "../bridge/normalizeEvolutionMessage.js";
import { createSilentLogger } from "./testDoubles.js";

function message(overrides: Partial<NormalizedIncomingMessage> = {}): NormalizedIncomingMessage {
  return {
    correlation_id: "corr_test",
    sender_id: "905333333333",
    phone_number: "905333333333",
    remote_jid: "905333333333@s.whatsapp.net",
    message_id: "msg_test",
    message_type: "conversation",
    text: "Merhaba",
    chat_type: "private",
    is_from_me: false,
    is_group: false,
    received_at: "2026-07-24T00:00:00.000Z",
    ...overrides
  };
}

describe("shadowQueue conversation isolation", () => {
  it("assigns a distinct conversation_key_hash per conversation, so different conversations do not serialize against each other", () => {
    const store = new InMemoryReliabilityQueueStore();
    const logger = createSilentLogger();

    enqueueInboundShadow({
      store,
      message: message({
        phone_number: "905333333333",
        remote_jid: "905333333333@s.whatsapp.net",
        message_id: "msg_a"
      }),
      logger
    });
    enqueueInboundShadow({
      store,
      message: message({
        phone_number: "905444444444",
        remote_jid: "905444444444@s.whatsapp.net",
        message_id: "msg_b"
      }),
      logger
    });

    const jobs = store.listJobs();
    expect(jobs).toHaveLength(2);
    const [hashA, hashB] = jobs.map((job) => job.conversation_key_hash);
    expect(hashA).toBeTruthy();
    expect(hashB).toBeTruthy();
    expect(hashA).not.toBe(hashB);

    // Before the Phase 9 fix, conversation_key_hash was never populated
    // (enqueue() call was missing the field entirely), so every shadow-queued
    // job ended up with the same `undefined` value and the store treated all
    // of them as one conversation - claiming the first job silently blocked
    // the second even though they came from two different candidates.
    const first = store.claimNext("inbound", "worker-1");
    const second = store.claimNext("inbound", "worker-2");
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first?.job_id).not.toBe(second?.job_id);
  });

  it("still serializes two jobs from the SAME conversation (regression guard alongside the isolation fix)", () => {
    const store = new InMemoryReliabilityQueueStore();
    const logger = createSilentLogger();

    enqueueInboundShadow({ store, message: message({ message_id: "msg_same_1" }), logger });
    enqueueInboundShadow({ store, message: message({ message_id: "msg_same_2" }), logger });

    const first = store.claimNext("inbound", "worker-1");
    const second = store.claimNext("inbound", "worker-2");
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });
});
