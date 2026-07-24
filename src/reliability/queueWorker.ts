import { redactSecrets } from "../utils/redaction.js";
import type { ConnectionHealthMonitor } from "../observability/connectionHealthMonitor.js";
import type { EvolutionSender } from "../bridge/sendTextMessage.js";
import type { Logger } from "../observability/logger.js";
import type { NormalizedIncomingMessage } from "../bridge/normalizeEvolutionMessage.js";
import type { ReliabilityQueueJob, ReliabilityQueueName, ReliabilityQueueStore } from "./queueTypes.js";
import type { ReliabilityJobStatus } from "./queueTypes.js";

export interface WorkerRunResult {
  picked: boolean;
  job_id?: string;
  status?: ReliabilityJobStatus;
}

export class ReliabilityQueueWorker {
  constructor(
    private readonly options: {
      queueName: ReliabilityQueueName;
      workerId: string;
      store: ReliabilityQueueStore;
      logger: Logger;
      connectionHealthMonitor?: ConnectionHealthMonitor;
      backoffMs?: (attempts: number) => number;
      staleLockThresholdMs?: number;
    },
  ) {}

  // Reclaims jobs left LEASED/PROCESSING by a worker that crashed before
  // finishing them, so they become retryable instead of stuck forever.
  // Intended to be called once when a worker starts, before it begins
  // polling with runOnce() - not called anywhere yet, since no caller
  // instantiates ReliabilityQueueWorker in production (see Phase 9
  // assessment: the worker itself is still not wired up).
  async start(): Promise<{ reclaimed_count: number }> {
    const staleMs = this.options.staleLockThresholdMs ?? 90_000;
    const reclaimed = this.options.store.reclaimStaleLocks(staleMs);
    if (reclaimed > 0) {
      this.options.logger.warn({
        event_type: "QUEUE_STALE_LOCKS_RECLAIMED",
        queue_name: this.options.queueName,
        worker_id: this.options.workerId,
        reclaimed_count: reclaimed,
      });
    }
    return { reclaimed_count: reclaimed };
  }

  async runOnce(handler: (job: ReliabilityQueueJob) => Promise<void>): Promise<WorkerRunResult> {
    const job = this.options.store.claimNext(this.options.queueName, this.options.workerId);
    if (!job) return { picked: false };
    this.options.connectionHealthMonitor?.recordWorkerPickup({ queue_name: this.options.queueName, job_id: job.job_id });

    try {
      await handler(job);
      this.options.store.markDone(job.job_id);
      return { picked: true, job_id: job.job_id, status: "COMPLETED" };
    } catch (error) {
      const permanent = error instanceof PermanentQueueError;
      const updated = this.options.store.markFailed(job.job_id, redactSecrets(error instanceof Error ? error.message : String(error)), {
        permanent,
        backoffMs: this.options.backoffMs?.(job.attempt_count) ?? undefined,
      });
      this.options.logger[updated.status === "DEAD_LETTER" ? "warn" : "info"]({
        event_type: updated.status === "DEAD_LETTER" ? "QUEUE_DEAD_LETTER" : "QUEUE_RETRY_SCHEDULED",
        queue_name: this.options.queueName,
        job_id: updated.job_id,
        attempt_count: updated.attempt_count,
        status: updated.status,
        error: updated.last_error,
      });
      this.options.connectionHealthMonitor?.recordWorkerError({
        queue_name: this.options.queueName,
        job_id: updated.job_id,
        error: updated.last_error ?? "worker_error",
      });
      return { picked: true, job_id: updated.job_id, status: updated.status };
    }
  }
}

export class PermanentQueueError extends Error {}

export async function processInboundJob(
  job: ReliabilityQueueJob,
  handler: (message: NormalizedIncomingMessage) => Promise<void>,
): Promise<void> {
  await handler(job.payload as unknown as NormalizedIncomingMessage);
}

export async function processOutboundJob(
  job: ReliabilityQueueJob,
  sender: EvolutionSender,
  connectionHealthMonitor?: ConnectionHealthMonitor,
): Promise<void> {
  const message = job.payload.message as NormalizedIncomingMessage | undefined;
  const text = typeof job.payload.text === "string" ? job.payload.text : "";
  if (!message || text.trim() === "") {
    throw new PermanentQueueError("Outbound job missing message or text.");
  }
  await sender.sendText({ message, text });
  connectionHealthMonitor?.recordSendConfirmed({
    correlation_id: message.correlation_id,
    message_id: message.message_id,
  });
}

// Note: ReliabilityQueueJob does not carry its own queue_name (see Phase 9
// assessment) - the caller already knows which queue it claimed from, so
// dry-run acknowledgement below trusts that context rather than an
// unverifiable field on the job itself.
export async function processInboundJobDryRun(job: ReliabilityQueueJob): Promise<{ would_process: true; job_id: string }> {
  return { would_process: true, job_id: job.job_id };
}

export async function processOutboundJobDryRun(job: ReliabilityQueueJob): Promise<{ would_send: true; job_id: string }> {
  return { would_send: true, job_id: job.job_id };
}
