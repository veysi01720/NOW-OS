import { describe, it, expect } from "vitest";
import { queueBacklogSnapshot } from "../reliability/queueMonitoring.js";
import { InMemoryReliabilityQueueStore } from "../reliability/inMemoryReliabilityQueueStore.js";

function fillQueuedJobs(store: InMemoryReliabilityQueueStore, count: number): void {
  for (let i = 0; i < count; i += 1) {
    store.enqueue({
      queue_name: "inbound",
      idempotency_key: `job-${i}`,
      tenant_id: "tenant-1",
      conversation_key_hash: `hash-${i}`,
      source_event_hash: "hash2",
      event_type: "message",
      payload: {}
    });
  }
}

describe("queueBacklogSnapshot workersEnabled gating (Phase 0.5)", () => {
  it("suppresses backlog_alarm when no worker is enabled, even past the pending threshold", () => {
    const store = new InMemoryReliabilityQueueStore({ maxEntries: 10_000 });
    fillQueuedJobs(store, 60);

    const snapshot = queueBacklogSnapshot(store, { pendingThreshold: 50, workersEnabled: false });
    expect(snapshot.inbound_queue_pending).toBe(60);
    expect(snapshot.backlog_alarm).toBe(false);
  });

  it("still raises backlog_alarm past the threshold when a worker is enabled", () => {
    const store = new InMemoryReliabilityQueueStore({ maxEntries: 10_000 });
    fillQueuedJobs(store, 60);

    const snapshot = queueBacklogSnapshot(store, { pendingThreshold: 50, workersEnabled: true });
    expect(snapshot.backlog_alarm).toBe(true);
  });

  it("defaults workersEnabled to true when not specified (unchanged behavior for existing callers)", () => {
    const store = new InMemoryReliabilityQueueStore({ maxEntries: 10_000 });
    fillQueuedJobs(store, 60);

    const snapshot = queueBacklogSnapshot(store, { pendingThreshold: 50 });
    expect(snapshot.backlog_alarm).toBe(true);
  });
});
