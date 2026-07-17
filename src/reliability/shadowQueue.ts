// @ts-nocheck
import { createHash } from "node:crypto";
import { redactSecrets } from "../utils/redaction.js";
import type { NormalizedIncomingMessage } from "../bridge/normalizeEvolutionMessage.js";
import type { ConnectionHealthMonitor } from "../observability/connectionHealthMonitor.js";
import type { Logger } from "../observability/logger.js";
import type { ReliabilityQueueStore } from "./queueTypes.js";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function buildInboundQueueIdempotencyKey(message: NormalizedIncomingMessage): string {
  return `inbound_${hash(message.remote_jid)}_${hash(message.message_id)}`;
}

export function buildOutboundQueueIdempotencyKey(message: NormalizedIncomingMessage, text: string): string {
  return `outbound_${hash(message.remote_jid)}_${hash(message.message_id)}_${hash(text)}`;
}

export function enqueueInboundShadow(input: {
  store?: ReliabilityQueueStore;
  message: NormalizedIncomingMessage;
  logger: Logger;
  connectionHealthMonitor?: ConnectionHealthMonitor;
}): void {
  if (!input.store) return;
  try {
    const job = input.store.enqueue({
      queue_name: "inbound",
      idempotency_key: buildInboundQueueIdempotencyKey(input.message),
      payload: input.message as unknown as Record<string, unknown>,
    });
    input.connectionHealthMonitor?.recordQueueWrite({
      queue_name: "inbound",
      correlation_id: input.message.correlation_id,
      success: true,
    });
    input.logger.info({
      event_type: "INBOUND_QUEUE_SHADOW_WRITTEN",
      correlation_id: input.message.correlation_id,
      queue_job_id: job.id,
      queue_status: job.status,
    });
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error));
    input.connectionHealthMonitor?.recordQueueWrite({
      queue_name: "inbound",
      correlation_id: input.message.correlation_id,
      success: false,
      error: message,
    });
    input.logger.warn({
      event_type: "INFRA_QUEUE_WRITE_ALERT",
      queue_name: "inbound",
      correlation_id: input.message.correlation_id,
      error: message,
      legacy_flow_preserved: true,
    });
  }
}

export function enqueueOutboundShadow(input: {
  store?: ReliabilityQueueStore;
  message: NormalizedIncomingMessage;
  text: string;
  logger: Logger;
  connectionHealthMonitor?: ConnectionHealthMonitor;
}): void {
  if (!input.store) return;
  try {
    const job = input.store.enqueue({
      queue_name: "outbound",
      idempotency_key: buildOutboundQueueIdempotencyKey(input.message, input.text),
      payload: {
        message: input.message,
        text: input.text,
      } as unknown as Record<string, unknown>,
    });
    input.connectionHealthMonitor?.recordQueueWrite({
      queue_name: "outbound",
      correlation_id: input.message.correlation_id,
      success: true,
    });
    input.logger.info({
      event_type: "OUTBOUND_QUEUE_SHADOW_WRITTEN",
      correlation_id: input.message.correlation_id,
      queue_job_id: job.id,
      queue_status: job.status,
      real_send_still_legacy_path: true,
    });
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error));
    input.connectionHealthMonitor?.recordQueueWrite({
      queue_name: "outbound",
      correlation_id: input.message.correlation_id,
      success: false,
      error: message,
    });
    input.logger.warn({
      event_type: "INFRA_QUEUE_WRITE_ALERT",
      queue_name: "outbound",
      correlation_id: input.message.correlation_id,
      error: message,
      legacy_flow_preserved: true,
    });
  }
}
