import { createHash } from "node:crypto";
import { redactSecrets } from "../utils/redaction.js";
import { getConversationKey } from "../bridge/buildBackendContext.js";
import type { NormalizedIncomingMessage } from "../bridge/normalizeEvolutionMessage.js";
import type { ConnectionHealthMonitor } from "../observability/connectionHealthMonitor.js";
import type { Logger } from "../observability/logger.js";
import type { ReliabilityQueueStore } from "./queueTypes.js";
import { INSTALLATION_VERIFICATION_MAX_BYTES } from "../bridge/installationVerification.js";

const TENANT_ID = "now_os";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function conversationKeyHash(message: NormalizedIncomingMessage): string {
  return hash(getConversationKey(message));
}

// The shadow queue is an observability side-write, not the real send/receive
// path - it must never carry the actual media bytes. Only size/type metadata
// is kept; the base64 payload itself is dropped unconditionally.
export function stripMediaBase64(
  message: NormalizedIncomingMessage,
  options?: { scope?: "installation_verification" },
): NormalizedIncomingMessage {
  if (!message.media?.base64) return message;
  if (
    options?.scope === "installation_verification" &&
    message.media.kind === "image"
  ) {
    const decodedSize = Buffer.from(message.media.base64.replace(/^data:[^;]+;base64,/u, ""), "base64").length;
    if (decodedSize > 0 && decodedSize <= INSTALLATION_VERIFICATION_MAX_BYTES) {
      // This is an ephemeral verifier hand-off only. Shadow queue callers never
      // pass this scope and therefore remain unconditionally sanitized.
      return message;
    }
  }
  const { base64: _base64, ...mediaWithoutBase64 } = message.media;
  return { ...message, media: mediaWithoutBase64 };
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
      tenant_id: TENANT_ID,
      conversation_key_hash: conversationKeyHash(input.message),
      source_event_hash: hash(input.message.text),
      event_type: "inbound_message",
      payload: stripMediaBase64(input.message) as unknown as Record<string, unknown>,
    });
    input.connectionHealthMonitor?.recordQueueWrite({
      queue_name: "inbound",
      correlation_id: input.message.correlation_id,
      success: true,
    });
    input.logger.info({
      event_type: "INBOUND_QUEUE_SHADOW_WRITTEN",
      correlation_id: input.message.correlation_id,
      queue_job_id: job.job_id,
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
      tenant_id: TENANT_ID,
      conversation_key_hash: conversationKeyHash(input.message),
      source_event_hash: hash(input.text),
      event_type: "outbound_reply",
      payload: {
        message: stripMediaBase64(input.message),
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
      queue_job_id: job.job_id,
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
