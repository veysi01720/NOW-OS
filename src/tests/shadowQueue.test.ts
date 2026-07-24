import { describe, it, expect } from "vitest";
import { enqueueInboundShadow, stripMediaBase64 } from "../reliability/shadowQueue.js";
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

describe("shadowQueue media exclusion (Phase 0.5)", () => {
  it("strips base64 from a media attachment while keeping size/type metadata", () => {
    const withMedia = message({
      media: {
        kind: "image",
        mimetype: "image/jpeg",
        file_name: "photo.jpg",
        file_size: 512_000,
        caption: "bakar misin",
        base64: "A".repeat(700_000)
      }
    });

    const sanitized = stripMediaBase64(withMedia);
    expect(sanitized.media?.base64).toBeUndefined();
    expect(sanitized.media?.kind).toBe("image");
    expect(sanitized.media?.mimetype).toBe("image/jpeg");
    expect(sanitized.media?.file_name).toBe("photo.jpg");
    expect(sanitized.media?.file_size).toBe(512_000);
    expect(sanitized.media?.caption).toBe("bakar misin");
  });

  it("never writes real media base64 content into the shadow queue payload", () => {
    const store = new InMemoryReliabilityQueueStore();
    const logger = createSilentLogger();
    const base64Payload = "B".repeat(700_000);

    enqueueInboundShadow({
      store,
      message: message({
        message_id: "msg_media",
        media: {
          kind: "document",
          mimetype: "application/pdf",
          file_name: "sozlesme.pdf",
          file_size: 512_000,
          caption: "",
          base64: base64Payload
        }
      }),
      logger
    });

    const jobs = store.listJobs();
    expect(jobs).toHaveLength(1);
    const storedMedia = jobs[0]?.payload.media as { base64?: string; file_name?: string } | undefined;
    expect(storedMedia?.base64).toBeUndefined();
    expect(storedMedia?.file_name).toBe("sozlesme.pdf");
    expect(JSON.stringify(jobs[0]?.payload)).not.toContain(base64Payload);
  });
});
