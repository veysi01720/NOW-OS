import { randomUUID } from "node:crypto";
import type {
  EnqueueReliabilityJobInput,
  QueueBacklogSnapshot,
  ReliabilityJobStatus,
  ReliabilityQueueJob,
  ReliabilityQueueName,
  ReliabilityQueueStore,
} from "./queueTypes.js";

function clone(job: ReliabilityQueueJob): ReliabilityQueueJob {
  return { ...job, payload: { ...job.payload } };
}

export class InMemoryReliabilityQueueStore implements ReliabilityQueueStore {
  private readonly jobs = new Map<string, ReliabilityQueueJob>();

  enqueue(input: EnqueueReliabilityJobInput): ReliabilityQueueJob {
    const existing = [...this.jobs.values()].find(
      (job) => job.idempotency_key === input.idempotency_key,
    );
    if (existing) return clone(existing);

    const now = new Date().toISOString();
    const job: ReliabilityQueueJob = {
      job_id: randomUUID(),
      idempotency_key: input.idempotency_key,
      tenant_id: input.tenant_id,
      conversation_key_hash: input.conversation_key_hash,
      source_event_hash: input.source_event_hash,
      event_type: input.event_type,
      enqueue_sequence: this.jobs.size + 1,
      attempt_count: 0,
      available_at: input.available_at ?? now,
      lease_until: null,
      status: "QUEUED",
      created_at: now,
      updated_at: now,
      payload: { ...input.payload },
      locked_by: null,
      last_error: null,
      max_attempts: input.max_attempts ?? 5,
    };
    this.jobs.set(job.job_id, job);
    return clone(job);
  }

  claimNext(queueName: ReliabilityQueueName, workerId: string, now: Date | string = new Date()): ReliabilityQueueJob | null {
    const allJobs = [...this.jobs.values()];
    const nowDate = typeof now === "string" ? new Date(now) : now;
    
    // Find conversations currently processing
    const processingConversations = new Set(
      allJobs
        .filter((job) => job.status === "LEASED" || job.status === "PROCESSING")
        .map((job) => job.conversation_key_hash)
    );

    const candidates = allJobs
      .filter((job) => (job.status === "QUEUED" || job.status === "RETRY_WAIT") && Date.parse(job.available_at) <= nowDate.getTime())
      .sort((a, b) => a.enqueue_sequence - b.enqueue_sequence);

    for (const candidate of candidates) {
      if (!processingConversations.has(candidate.conversation_key_hash)) {
        candidate.status = "LEASED";
        candidate.attempt_count += 1;
        candidate.locked_by = workerId;
        const leaseTime = new Date(nowDate.getTime() + 60000); // 1 min lease
        candidate.lease_until = leaseTime.toISOString();
        candidate.updated_at = nowDate.toISOString();
        return clone(candidate);
      }
    }

    return null;
  }

  markDone(jobId: string, now = new Date()): void {
    const job = this.requireJob(jobId);
    job.status = "COMPLETED";
    job.locked_by = null;
    job.lease_until = null;
    job.updated_at = now.toISOString();
  }

  markFailed(
    jobId: string,
    error: string,
    options: { permanent?: boolean; now?: Date; backoffMs?: number } = {},
  ): ReliabilityQueueJob {
    const now = options.now ?? new Date();
    const job = this.requireJob(jobId);
    const reachedMaxAttempts = job.attempt_count >= (job.max_attempts ?? 5);
    const nextStatus: ReliabilityJobStatus = options.permanent
      ? "DEAD_LETTER"
      : reachedMaxAttempts
        ? "DEAD_LETTER"
        : "RETRY_WAIT";

    job.status = nextStatus;
    job.last_error = error.slice(0, 500);
    job.locked_by = null;
    job.lease_until = null;
    job.available_at = nextStatus === "RETRY_WAIT"
      ? new Date(now.getTime() + (options.backoffMs ?? this.defaultBackoffMs(job.attempt_count))).toISOString()
      : now.toISOString();
    job.updated_at = now.toISOString();
    return clone(job);
  }

  reclaimStaleLocks(staleMs: number, now = new Date()): number {
    let reclaimed = 0;
    for (const job of this.jobs.values()) {
      if ((job.status !== "PROCESSING" && job.status !== "LEASED") || job.lease_until === null) continue;
      if (now.getTime() < Date.parse(job.lease_until)) continue; // lease is still valid
      job.status = "RETRY_WAIT";
      job.locked_by = null;
      job.lease_until = null;
      job.available_at = now.toISOString();
      job.updated_at = now.toISOString();
      reclaimed += 1;
    }
    return reclaimed;
  }

  counts(): QueueBacklogSnapshot {
    const jobs = [...this.jobs.values()];
    const queued = jobs.filter((job) => job.status === "QUEUED" || job.status === "RETRY_WAIT").length;
    const deadLetters = jobs.filter((job) => job.status === "DEAD_LETTER").length;
    return {
      inbound_queue_pending: queued,
      outbound_queue_pending: 0,
      dead_letter_count: deadLetters,
      failed_count: jobs.filter((job) => job.status === "DEAD_LETTER").length,
      processing_count: jobs.filter((job) => job.status === "PROCESSING" || job.status === "LEASED").length,
      backlog_alarm: queued >= 50,
      dead_letter_alarm: deadLetters > 0,
    };
  }

  listJobs(): ReliabilityQueueJob[] {
    return [...this.jobs.values()].map(clone);
  }

  private requireJob(jobId: string): ReliabilityQueueJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Queue job not found: ${jobId}`);
    return job;
  }

  private defaultBackoffMs(attempts: number): number {
    return Math.min(60_000, 1000 * 2 ** Math.max(0, attempts - 1));
  }
}
