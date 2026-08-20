import { createHash } from "node:crypto";
import type { Logger } from "../observability/logger.js";
import type { EvolutionSender, SendTextInput } from "../bridge/sendTextMessage.js";
import type { NormalizedIncomingMessage } from "../bridge/normalizeEvolutionMessage.js";
import { redactSecrets } from "../utils/redaction.js";
import { buildOutboundQueueIdempotencyKey, stripMediaBase64 } from "./shadowQueue.js";
import type { DeliveryEventLedger } from "./deliveryEventLedger.js";
import type { ReliabilityQueueStore } from "./queueTypes.js";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function minimalMessage(message: NormalizedIncomingMessage): NormalizedIncomingMessage {
  const safe = stripMediaBase64(message);
  return {
    ...safe,
    sender_id: "",
    text: "",
    push_name: undefined,
    media: undefined,
  };
}

export class OutboundDeliveryDeferredError extends Error {
  constructor() {
    super("Outbound delivery persisted for retry");
    this.name = "OutboundDeliveryDeferredError";
  }
}

export class ReliableEvolutionSender implements EvolutionSender {
  constructor(private readonly options: {
    rawSender: EvolutionSender;
    store: ReliabilityQueueStore;
    ledger: DeliveryEventLedger;
    logger: Logger;
    workerId?: string;
    maxAttempts?: number;
    retryBackoffMs?: number;
  }) {}

  async sendText(input: SendTextInput): Promise<void> {
    const job = this.options.store.enqueue({
      queue_name: "outbound",
      idempotency_key: buildOutboundQueueIdempotencyKey(input.message, input.text),
      tenant_id: "now_os",
      conversation_key_hash: hash(input.message.remote_jid),
      source_event_hash: hash(input.text),
      event_type: "outbound_send_text",
      max_attempts: this.options.maxAttempts ?? 5,
      payload: {
        message: minimalMessage(input.message),
        text: input.text,
      } as unknown as Record<string, unknown>,
    });
    if (job.status === "COMPLETED") return;
    this.options.ledger.append({
      event_type: "outbound_queued",
      correlation_id: input.message.correlation_id,
      job_id: job.job_id,
      status: job.status,
    });
    const claimed = this.options.store.claimById(job.job_id, this.options.workerId ?? "inline-outbound");
    if (!claimed) throw new OutboundDeliveryDeferredError();
    try {
      await this.options.rawSender.sendText(input);
      this.options.store.markDone(job.job_id);
      this.options.ledger.append({
        event_type: "outbound_delivered",
        correlation_id: input.message.correlation_id,
        job_id: job.job_id,
        status: "COMPLETED",
      });
    } catch (error) {
      const updated = this.options.store.markFailed(
        job.job_id,
        redactSecrets(error instanceof Error ? error.message : String(error)),
        this.options.retryBackoffMs === undefined ? undefined : { backoffMs: this.options.retryBackoffMs },
      );
      this.options.ledger.append({
        event_type: updated.status === "DEAD_LETTER" ? "outbound_dead_letter" : "outbound_retry_scheduled",
        correlation_id: input.message.correlation_id,
        job_id: job.job_id,
        status: updated.status,
        metadata: { attempt_count: updated.attempt_count },
      });
      this.options.logger.warn({
        event_type: updated.status === "DEAD_LETTER" ? "OUTBOUND_DEAD_LETTER" : "OUTBOUND_RETRY_PERSISTED",
        correlation_id: input.message.correlation_id,
        queue_job_id: job.job_id,
        attempt_count: updated.attempt_count,
        raw_text_logged: false,
      });
      throw error;
    }
  }
}
