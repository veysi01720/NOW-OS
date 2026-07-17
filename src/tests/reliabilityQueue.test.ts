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
});
