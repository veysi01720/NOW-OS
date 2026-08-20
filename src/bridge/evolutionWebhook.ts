import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { isInboundDualWriteEnabled } from "../reliability/queueModes.js";
import { enqueueInboundShadow } from "../reliability/shadowQueue.js";
import { redactSecrets } from "../utils/redaction.js";
import { handleIncomingMessage, type HandleIncomingMessageDeps, type HandleIncomingMessageResult } from "./handleIncomingMessage.js";
import { normalizeEvolutionMessage } from "./normalizeEvolutionMessage.js";

export function buildEvolutionIdempotencyKey(platform: string, _chatId: string, messageId: string): string {
  const msgHash = createHash("sha256").update(messageId).digest("hex").slice(0, 16);
  return `${platform}_${msgHash}`;
}

function getRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getEvolutionEventName(payload: unknown): string {
  const root = getRecord(payload);
  const data = getRecord(root.data);
  const event = root.event ?? data.event ?? root.eventName;
  return typeof event === "string" ? event : "";
}

function isMessagesUpsertEvent(eventName: string): boolean {
  const normalized = eventName.trim().toLowerCase();
  return normalized === "" || normalized === "messages.upsert" || normalized === "messages_upsert";
}

function isConnectionUpdateEvent(eventName: string): boolean {
  const normalized = eventName.trim().toLowerCase();
  return normalized === "connection.update" || normalized === "connection_update" || normalized === "connectionupdate";
}

function isMessagesUpdateEvent(eventName: string): boolean {
  const normalized = eventName.trim().toLowerCase();
  return normalized === "messages.update" || normalized === "messages_update" || normalized === "messagesupdate";
}

function getMessageUpdateRecords(payload: unknown): Array<Record<string, unknown>> {
  const root = getRecord(payload);
  const data = root.data;
  if (Array.isArray(data)) return data.map(getRecord).filter((item) => Object.keys(item).length > 0);
  const dataRecord = getRecord(data);
  if (Array.isArray(dataRecord.messages)) {
    return dataRecord.messages.map(getRecord).filter((item) => Object.keys(item).length > 0);
  }
  return Object.keys(dataRecord).length > 0 ? [dataRecord] : [];
}

function parseInboundMessageUpdates(payload: unknown): Array<{ message_id: string; status?: number }> {
  return getMessageUpdateRecords(payload).flatMap((record) => {
    const key = getRecord(record.key);
    if (key.fromMe !== false || typeof key.id !== "string" || key.id.trim() === "") return [];
    const statusValue = record.status ?? getRecord(record.update).status;
    const status = typeof statusValue === "number" ? statusValue : Number(statusValue);
    return [{
      message_id: key.id.trim(),
      ...(Number.isFinite(status) ? { status } : {}),
    }];
  });
}

async function processEvolutionInbound(
  payload: unknown,
  deps: HandleIncomingMessageDeps,
  webhookReceivedAtMs: number,
): Promise<HandleIncomingMessageResult | { status: "ignored"; reason: string }> {
  const normalized = normalizeEvolutionMessage(payload);
  normalized.telemetry = {
    webhook_received_at_ms: webhookReceivedAtMs,
    normalized_at_ms: Date.now(),
  };
  if (!normalized.is_from_me) {
    deps.connectionHealthMonitor?.recordInboundConfirmed({
      correlation_id: normalized.correlation_id,
      message_id: normalized.message_id,
      chat_type: normalized.chat_type,
    });
  }
  deps.logger.info({
    event_type: "MESSAGE_NORMALIZED",
    correlation_id: normalized.correlation_id,
    message_id: normalized.message_id,
    chat_type: normalized.chat_type,
    is_from_me: normalized.is_from_me,
  });
  if (normalized.message_id.trim() === "") {
    deps.logger.info({
      event_type: "MESSAGE_IGNORED_MISSING_PROVIDER_MESSAGE_ID",
      correlation_id: normalized.correlation_id,
    });
    return { status: "ignored", reason: "missing_provider_message_id" };
  }

  if (isInboundDualWriteEnabled(deps.env.webhookQueueMode)) {
    enqueueInboundShadow({
      store: deps.reliabilityQueueStore,
      message: normalized,
      logger: deps.logger,
      connectionHealthMonitor: deps.connectionHealthMonitor,
    });
  }

  const dedupeKey = buildEvolutionIdempotencyKey("evolution", normalized.remote_jid, normalized.message_id);
  if (deps.messageDedupeStore.isDuplicate(dedupeKey)) {
    deps.logger.info({
      event_type: "DUPLICATE_MESSAGE_IGNORED",
      correlation_id: normalized.correlation_id,
      reason: "Message already processed",
    });
    return { status: "ignored", reason: "duplicate" };
  }

  const result = await handleIncomingMessage(normalized, deps);
  deps.messageDedupeStore.markSeen(dedupeKey, {
    message_id: normalized.message_id,
    sender_id: normalized.sender_id,
    remote_jid: normalized.remote_jid,
    correlation_id: normalized.correlation_id,
    status: "processed",
  });
  return result;
}

export function registerEvolutionWebhook(app: FastifyInstance, deps: HandleIncomingMessageDeps): void {
  app.post("/webhooks/evolution", async (request, reply) => {
    let correlationId: string | undefined;

    try {
      const webhookReceivedAtMs = Date.now();
      deps.logger.info({ event_type: "WEBHOOK_RECEIVED" });
      const eventName = getEvolutionEventName(request.body);
      if (isConnectionUpdateEvent(eventName)) {
        const root = getRecord(request.body);
        const data = getRecord(root.data);
        const instance = getRecord(data.instance ?? root.instance);
        const state = typeof (data.state ?? instance.state ?? root.state) === "string"
          ? String(data.state ?? instance.state ?? root.state)
          : undefined;
        const statusReasonValue = data.statusReason ?? instance.statusReason ?? root.statusReason;
        const statusReason = typeof statusReasonValue === "number" ? statusReasonValue : Number(statusReasonValue);
        deps.connectionHealthMonitor?.recordEvolutionConnectionUpdate({
          state,
          statusReason: Number.isFinite(statusReason) ? statusReason : undefined,
        });
        deps.logger.info({ event_type: "EVOLUTION_CONNECTION_UPDATE_OBSERVED", state, status_reason: Number.isFinite(statusReason) ? statusReason : undefined });
        return reply.code(200).send({ status: "ignored", reason: "connection_update_observed" });
      }
      if (isMessagesUpdateEvent(eventName)) {
        const updates = parseInboundMessageUpdates(request.body);
        for (const update of updates) {
          const dedupeKey = buildEvolutionIdempotencyKey("evolution", "", update.message_id);
          deps.connectionHealthMonitor?.recordInboundMessageUpdate({
            message_id: update.message_id,
            status: update.status,
            known: deps.messageDedupeStore.isDuplicate(dedupeKey),
            process_recovered: async (record) => {
              const result = await processEvolutionInbound(
                { event: "messages.upsert", data: record },
                deps,
                Date.now(),
              );
              return result.status !== "reply_send_failed";
            },
          });
        }
        deps.logger.info({
          event_type: "EVOLUTION_MESSAGE_UPDATE_OBSERVED",
          inbound_update_count: updates.length,
          raw_message_logged: false,
        });
        return reply.code(200).send({ status: "ignored", reason: "message_update_observed" });
      }
      if (!isMessagesUpsertEvent(eventName)) {
        deps.logger.info({ event_type: "NON_MESSAGE_WEBHOOK_IGNORED", event_name: eventName || "unknown" });
        return reply.code(200).send({ status: "ignored", reason: "non_message_event" });
      }

      const result = await processEvolutionInbound(request.body, deps, webhookReceivedAtMs);
      return reply.code(200).send(result);
    } catch (error) {
      deps.logger.error({
        event_type: "BRIDGE_ERROR",
        ...(correlationId ? { correlation_id: correlationId } : {}),
        error: redactSecrets(error instanceof Error ? error.message : String(error)),
        stack: redactSecrets(error instanceof Error && error.stack ? error.stack : "") || undefined,
      });
      return reply.code(500).send({ status: "error", correlation_id: correlationId });
    }
  });
}
