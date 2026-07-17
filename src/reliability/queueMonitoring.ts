import type { Logger } from "../observability/logger.js";
import type { QueueBacklogSnapshot, ReliabilityQueueStore } from "./queueTypes.js";

export interface QueueMonitorOptions {
  pendingThreshold?: number;
  deadLetterThreshold?: number;
}

export function queueBacklogSnapshot(
  store: ReliabilityQueueStore,
  options: QueueMonitorOptions = {},
): QueueBacklogSnapshot {
  const snapshot = store.counts();
  const pendingThreshold = options.pendingThreshold ?? 50;
  const deadLetterThreshold = options.deadLetterThreshold ?? 1;
  return {
    ...snapshot,
    backlog_alarm: snapshot.inbound_queue_pending + snapshot.outbound_queue_pending >= pendingThreshold,
    dead_letter_alarm: snapshot.dead_letter_count >= deadLetterThreshold,
  };
}

export function emitQueueInfraAlerts(
  snapshot: QueueBacklogSnapshot,
  logger: Logger,
): void {
  if (snapshot.backlog_alarm) {
    logger.warn({
      event_type: "INFRA_QUEUE_BACKLOG_ALERT",
      inbound_queue_pending: snapshot.inbound_queue_pending,
      outbound_queue_pending: snapshot.outbound_queue_pending,
    });
  }
  if (snapshot.dead_letter_alarm) {
    logger.warn({
      event_type: "INFRA_QUEUE_DEAD_LETTER_ALERT",
      dead_letter_count: snapshot.dead_letter_count,
    });
  }
}
