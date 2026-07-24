import { randomUUID } from "node:crypto";
import type {
  EnqueueReliabilityJobInput,
  QueueBacklogSnapshot,
  ReliabilityJobStatus,
  ReliabilityQueueJob,
  ReliabilityQueueName,
  ReliabilityQueueStore,
} from "./queueTypes.js";

const DEFAULT_MAX_ENTRIES = 1000;
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

function clone(job: ReliabilityQueueJob): ReliabilityQueueJob {
  return { ...job, payload: { ...job.payload } };
}

export interface InMemoryReliabilityQueueStoreOptions {
  maxEntries?: number;
  ttlMs?: number;
  now?: () => Date;
}

export class InMemoryReliabilityQueueStore implements ReliabilityQueueStore {
  private readonly jobs = new Map<string, ReliabilityQueueJob>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly clock: () => Date;
  private sequenceCounter = 0;

  constructor(options: InMemoryReliabilityQueueStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.clock = options.now ?? (() => new Date());
  }

  enqueue(input: EnqueueReliabilityJobInput): ReliabilityQueueJob {
    this.prune(this.clock());
    const existing = [...this.jobs.values()].find(
      (job) => job.idempotency_key === input.idempotency_key,
    );
    if (existing) return clone(existing);

    const now = this.clock().toISOString();
    this.sequenceCounter += 1;
    const job: ReliabilityQueueJob = {
      job_id: randomUUID(),
      idempotency_key: input.idempotency_key,
      tenant_id: input.tenant_id,
      conversation_key_hash: input.conversation_key_hash,
      source_event_hash: input.source_event_hash,
      event_type: input.event_type,
      enqueue_sequence: this.sequenceCounter,
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
    this.prune(this.clock());
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
    this.prune(this.clock());
    return [...this.jobs.values()].map(clone);
  }

  // Bounds memory growth for a store that nothing else ever drains on its
  // own (e.g. shadow-write mode with no worker consuming jobs). Two
  // independent limits:
  // 1. TTL: any job older than ttlMs is removed regardless of status -
  //    this is the only limit that actually bites when every job stays
  //    QUEUED forever (no worker means nothing ever reaches COMPLETED).
  // 2. Max entries: once over the cap, the oldest COMPLETED/DEAD_LETTER
  //    (terminal) jobs are evicted first. Non-terminal jobs (QUEUED,
  //    LEASED, PROCESSING, RETRY_WAIT) are never evicted this way, since
  //    that would silently drop work a real worker still needs to see.
  private prune(now: Date): void {
    const nowMs = now.getTime();
    for (const [id, job] of this.jobs) {
      if (nowMs - Date.parse(job.created_at) > this.ttlMs) {
        this.jobs.delete(id);
      }
    }

    const overflow = this.jobs.size - this.maxEntries;
    if (overflow <= 0) return;

    const evictable = [...this.jobs.values()]
      .filter((job) => job.status === "COMPLETED" || job.status === "DEAD_LETTER")
      .sort((a, b) => a.enqueue_sequence - b.enqueue_sequence);

    let remaining = overflow;
    for (const job of evictable) {
      if (remaining <= 0) break;
      this.jobs.delete(job.job_id);
      remaining -= 1;
    }
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
