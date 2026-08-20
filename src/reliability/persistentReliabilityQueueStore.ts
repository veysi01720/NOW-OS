import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  EnqueueReliabilityJobInput,
  QueueBacklogSnapshot,
  ReliabilityJobStatus,
  ReliabilityQueueJob,
  ReliabilityQueueName,
  ReliabilityQueueStore,
} from "./queueTypes.js";

interface PersistentQueueData {
  version: 1;
  sequence_counter: number;
  jobs: ReliabilityQueueJob[];
}

function clone(job: ReliabilityQueueJob): ReliabilityQueueJob {
  return { ...job, payload: structuredClone(job.payload) };
}

function emptyData(): PersistentQueueData {
  return { version: 1, sequence_counter: 0, jobs: [] };
}

function isQueueName(value: unknown): value is ReliabilityQueueName {
  return value === "inbound" || value === "outbound";
}

export class PersistentReliabilityQueueStore implements ReliabilityQueueStore {
  private data: PersistentQueueData;

  constructor(
    private readonly filePath: string,
    private readonly options: { completedRetentionMs?: number; maxCompletedEntries?: number } = {},
  ) {
    this.data = this.load();
  }

  enqueue(input: EnqueueReliabilityJobInput): ReliabilityQueueJob {
    const existing = this.data.jobs.find((job) => job.idempotency_key === input.idempotency_key);
    if (existing) return clone(existing);
    const now = new Date().toISOString();
    this.data.sequence_counter += 1;
    const job: ReliabilityQueueJob = {
      job_id: randomUUID(),
      queue_name: input.queue_name,
      idempotency_key: input.idempotency_key,
      tenant_id: input.tenant_id,
      conversation_key_hash: input.conversation_key_hash,
      source_event_hash: input.source_event_hash,
      event_type: input.event_type,
      enqueue_sequence: this.data.sequence_counter,
      attempt_count: 0,
      available_at: input.available_at ?? now,
      lease_until: null,
      status: "QUEUED",
      created_at: now,
      updated_at: now,
      payload: structuredClone(input.payload),
      locked_by: null,
      last_error: null,
      max_attempts: input.max_attempts ?? 5,
    };
    this.data.jobs.push(job);
    this.persist();
    return clone(job);
  }

  claimNext(queueName: ReliabilityQueueName, workerId: string, now = new Date()): ReliabilityQueueJob | null {
    const candidates = this.data.jobs
      .filter((job) => job.queue_name === queueName && this.claimable(job, now))
      .sort((left, right) => left.enqueue_sequence - right.enqueue_sequence);
    for (const job of candidates) {
      const claimed = this.claim(job, workerId, now);
      if (claimed) return claimed;
    }
    return null;
  }

  claimById(jobId: string, workerId: string, now = new Date()): ReliabilityQueueJob | null {
    const job = this.data.jobs.find((candidate) => candidate.job_id === jobId);
    if (!job || !this.claimable(job, now)) return null;
    return this.claim(job, workerId, now);
  }

  markDone(jobId: string, now = new Date()): void {
    const job = this.requireJob(jobId);
    job.status = "COMPLETED";
    job.locked_by = null;
    job.lease_until = null;
    job.updated_at = now.toISOString();
    this.persist();
  }

  markFailed(
    jobId: string,
    error: string,
    options: { permanent?: boolean; now?: Date; backoffMs?: number } = {},
  ): ReliabilityQueueJob {
    const now = options.now ?? new Date();
    const job = this.requireJob(jobId);
    const reachedMaxAttempts = job.attempt_count >= (job.max_attempts ?? 5);
    const nextStatus: ReliabilityJobStatus = options.permanent || reachedMaxAttempts ? "DEAD_LETTER" : "RETRY_WAIT";
    job.status = nextStatus;
    job.last_error = error.slice(0, 500);
    job.locked_by = null;
    job.lease_until = null;
    job.available_at = nextStatus === "RETRY_WAIT"
      ? new Date(now.getTime() + (options.backoffMs ?? this.backoffMs(job.attempt_count))).toISOString()
      : now.toISOString();
    job.updated_at = now.toISOString();
    this.persist();
    return clone(job);
  }

  reclaimStaleLocks(_staleMs: number, now = new Date()): number {
    let reclaimed = 0;
    for (const job of this.data.jobs) {
      if ((job.status !== "LEASED" && job.status !== "PROCESSING") || !job.lease_until) continue;
      if (Date.parse(job.lease_until) > now.getTime()) continue;
      job.status = "RETRY_WAIT";
      job.locked_by = null;
      job.lease_until = null;
      job.available_at = now.toISOString();
      job.updated_at = now.toISOString();
      reclaimed += 1;
    }
    if (reclaimed > 0) this.persist();
    return reclaimed;
  }

  counts(): QueueBacklogSnapshot {
    const pending = (queue: ReliabilityQueueName) => this.data.jobs.filter(
      (job) => job.queue_name === queue && (job.status === "QUEUED" || job.status === "RETRY_WAIT"),
    ).length;
    const dead = this.data.jobs.filter((job) => job.status === "DEAD_LETTER").length;
    return {
      inbound_queue_pending: pending("inbound"),
      outbound_queue_pending: pending("outbound"),
      dead_letter_count: dead,
      failed_count: dead,
      processing_count: this.data.jobs.filter((job) => job.status === "LEASED" || job.status === "PROCESSING").length,
      backlog_alarm: pending("inbound") + pending("outbound") >= 50,
      dead_letter_alarm: dead > 0,
    };
  }

  listJobs(): ReliabilityQueueJob[] {
    return this.data.jobs.map(clone);
  }

  private claimable(job: ReliabilityQueueJob, now: Date): boolean {
    return (job.status === "QUEUED" || job.status === "RETRY_WAIT") && Date.parse(job.available_at) <= now.getTime();
  }

  private claim(job: ReliabilityQueueJob, workerId: string, now: Date): ReliabilityQueueJob | null {
    const conversationBusy = this.data.jobs.some(
      (candidate) => candidate.job_id !== job.job_id
        && candidate.conversation_key_hash === job.conversation_key_hash
        && (candidate.status === "LEASED" || candidate.status === "PROCESSING"),
    );
    if (conversationBusy) return null;
    job.status = "LEASED";
    job.attempt_count += 1;
    job.locked_by = workerId;
    job.lease_until = new Date(now.getTime() + 60_000).toISOString();
    job.updated_at = now.toISOString();
    this.persist();
    return clone(job);
  }

  private requireJob(jobId: string): ReliabilityQueueJob {
    const job = this.data.jobs.find((candidate) => candidate.job_id === jobId);
    if (!job) throw new Error(`Queue job not found: ${jobId}`);
    return job;
  }

  private load(): PersistentQueueData {
    if (!existsSync(this.filePath)) return emptyData();
    const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<PersistentQueueData>;
    if (parsed.version !== 1 || !Number.isInteger(parsed.sequence_counter) || !Array.isArray(parsed.jobs)) {
      throw new Error("Invalid persistent reliability queue schema");
    }
    for (const job of parsed.jobs) {
      if (!job || !isQueueName(job.queue_name) || typeof job.job_id !== "string" || typeof job.idempotency_key !== "string") {
        throw new Error("Invalid persistent reliability queue job");
      }
    }
    return parsed as PersistentQueueData;
  }

  private persist(): void {
    this.pruneCompleted();
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp-${process.pid}`;
    writeFileSync(temporary, `${JSON.stringify(this.data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, this.filePath);
    chmodSync(this.filePath, 0o600);
  }

  private pruneCompleted(): void {
    const retentionMs = this.options.completedRetentionMs ?? 7 * 24 * 60 * 60 * 1000;
    const maxCompleted = this.options.maxCompletedEntries ?? 5000;
    const cutoff = Date.now() - retentionMs;
    const completed = this.data.jobs
      .filter((job) => job.status === "COMPLETED")
      .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));
    const keep = new Set(completed.slice(0, maxCompleted).filter((job) => Date.parse(job.updated_at) >= cutoff).map((job) => job.job_id));
    this.data.jobs = this.data.jobs.filter((job) => job.status !== "COMPLETED" || keep.has(job.job_id));
  }

  private backoffMs(attempts: number): number {
    return Math.min(15 * 60_000, 5000 * 2 ** Math.max(0, attempts - 1));
  }
}
