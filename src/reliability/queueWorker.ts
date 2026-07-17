// @ts-nocheck
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
    },
  ) {}

  async runOnce(handler: (job: ReliabilityQueueJob) => Promise<void>): Promise<WorkerRunResult> {
    const job = this.options.store.claimNext(this.options.queueName, this.options.workerId);
    if (!job) return { picked: false };
    this.options.connectionHealthMonitor?.recordWorkerPickup({ queue_name: this.options.queueName, job_id: job.id });

    try {
      await handler(job);
      this.options.store.markDone(job.id);
      return { picked: true, job_id: job.id, status: "done" };
    } catch (error) {
      const permanent = error instanceof PermanentQueueError;
      const updated = this.options.store.markFailed(job.id, redactSecrets(error instanceof Error ? error.message : String(error)), {
        permanent,
        backoffMs: this.options.backoffMs?.(job.attempts) ?? undefined,
      });
      this.options.logger[updated.status === "dead_letter" || updated.status === "failed" ? "warn" : "info"]({
        event_type: updated.status === "dead_letter" ? "QUEUE_DEAD_LETTER" : "QUEUE_RETRY_SCHEDULED",
        queue_name: this.options.queueName,
        job_id: updated.id,
        attempts: updated.attempts,
        status: updated.status,
        error: updated.last_error,
      });
      this.options.connectionHealthMonitor?.recordWorkerError({
        queue_name: this.options.queueName,
        job_id: updated.id,
        error: updated.last_error ?? "worker_error",
      });
      return { picked: true, job_id: updated.id, status: updated.status };
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

export async function processInboundJobDryRun(job: ReliabilityQueueJob): Promise<{ would_process: true; job_id: string }> {
  if (job.queue_name !== "inbound") {
    throw new PermanentQueueError("Dry-run inbound worker received non-inbound job.");
  }
  return { would_process: true, job_id: job.id };
}

export async function processOutboundJobDryRun(job: ReliabilityQueueJob): Promise<{ would_send: true; job_id: string }> {
  if (job.queue_name !== "outbound") {
    throw new PermanentQueueError("Dry-run outbound worker received non-outbound job.");
  }
  return { would_send: true, job_id: job.id };
}
