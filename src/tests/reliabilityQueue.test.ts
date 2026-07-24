import { describe, it, expect, vi } from "vitest";
import { InMemoryReliabilityQueueStore } from "../reliability/inMemoryReliabilityQueueStore.js";
import type { EnqueueReliabilityJobInput } from "../reliability/queueTypes.js";

describe("Reliability Queue Tests (PostgreSQL Contract)", () => {
  it("enqueues a job correctly according to the new contract", () => {
    const store = new InMemoryReliabilityQueueStore();
    const input: EnqueueReliabilityJobInput = {
      queue_name: "inbound",
      idempotency_key: "test-123",
      tenant_id: "tenant-1",
      conversation_key_hash: "hash",
      source_event_hash: "hash2",
      event_type: "message",
      payload: { foo: "bar" }
    };
    const job = store.enqueue(input);
    
    expect(job.job_id).toBeDefined();
    expect(job.status).toBe("QUEUED");
    expect(job.payload.foo).toBe("bar");
    expect((job as any).queue_name).toBeUndefined(); // Verify queue_name is not in the job itself
  });

  it("claims a job using the new claimNext contract (queueName, workerId, now)", () => {
    const store = new InMemoryReliabilityQueueStore();
    store.enqueue({
      queue_name: "inbound",
      idempotency_key: "test-456",
      tenant_id: "tenant-1",
      conversation_key_hash: "hash",
      source_event_hash: "hash2",
      event_type: "message",
      payload: {}
    });

    const claimed = store.claimNext("inbound", "worker-1", new Date());
    expect(claimed).not.toBeNull();
    expect(claimed?.status).toBe("LEASED");
    expect(claimed?.locked_by).toBe("worker-1");
  });

  it("marks a job as done", () => {
    const store = new InMemoryReliabilityQueueStore();
    store.enqueue({
      queue_name: "inbound",
      idempotency_key: "test-789",
      tenant_id: "tenant-1",
      conversation_key_hash: "hash",
      source_event_hash: "hash2",
      event_type: "message",
      payload: {}
    });
    const job = store.claimNext("inbound", "worker-1", new Date());
    store.markDone(job!.job_id);

    const jobs = store.listJobs();
    const updatedJob = jobs.find(j => j.job_id === job!.job_id);
    expect(updatedJob?.status).toBe("COMPLETED");
  });

  it("handles max attempts and moves to dead letter", () => {
    const store = new InMemoryReliabilityQueueStore();
    store.enqueue({
      queue_name: "inbound",
      idempotency_key: "test-111",
      tenant_id: "tenant-1",
      conversation_key_hash: "hash",
      source_event_hash: "hash2",
      event_type: "message",
      payload: {},
      max_attempts: 2
    });

    let job = store.claimNext("inbound", "worker-1", new Date());
    store.markFailed(job!.job_id, "error 1");

    // job is in RETRY_WAIT. claimNext with future date
    job = store.claimNext("inbound", "worker-1", new Date(Date.now() + 100000));
    store.markFailed(job!.job_id, "error 2");

    const jobs = store.listJobs();
    const updatedJob = jobs.find(j => j.job_id === job!.job_id);
    expect(updatedJob?.status).toBe("DEAD_LETTER");
  });

  it("evicts any job older than ttlMs regardless of status (Phase 0.5 bound)", () => {
    let current = new Date("2026-07-24T00:00:00.000Z");
    const store = new InMemoryReliabilityQueueStore({ ttlMs: 60 * 60 * 1000, now: () => current });

    store.enqueue({
      queue_name: "inbound",
      idempotency_key: "ttl-1",
      tenant_id: "tenant-1",
      conversation_key_hash: "hash-1",
      source_event_hash: "hash2",
      event_type: "message",
      payload: {}
    });
    expect(store.listJobs()).toHaveLength(1);

    current = new Date(current.getTime() + 61 * 60 * 1000);
    expect(store.listJobs()).toHaveLength(0);
  });

  it("evicts the oldest COMPLETED/DEAD_LETTER jobs once maxEntries is exceeded", () => {
    const store = new InMemoryReliabilityQueueStore({ maxEntries: 3, ttlMs: 24 * 60 * 60 * 1000 });

    for (let i = 0; i < 3; i += 1) {
      store.enqueue({
        queue_name: "inbound",
        idempotency_key: `max-${i}`,
        tenant_id: "tenant-1",
        conversation_key_hash: `hash-${i}`,
        source_event_hash: "hash2",
        event_type: "message",
        payload: {}
      });
    }
    for (let i = 0; i < 3; i += 1) {
      const claimed = store.claimNext("inbound", "worker-1");
      store.markDone(claimed!.job_id);
    }
    expect(store.listJobs()).toHaveLength(3);

    store.enqueue({
      queue_name: "inbound",
      idempotency_key: "max-3",
      tenant_id: "tenant-1",
      conversation_key_hash: "hash-3",
      source_event_hash: "hash2",
      event_type: "message",
      payload: {}
    });

    const remaining = store.listJobs();
    expect(remaining).toHaveLength(3);
    expect(remaining.some((job) => job.idempotency_key === "max-0")).toBe(false);
    expect(remaining.some((job) => job.idempotency_key === "max-3")).toBe(true);
  });
});
