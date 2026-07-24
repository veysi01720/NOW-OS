import type { Logger } from "../observability/logger.js";
import type { QueueBacklogSnapshot, ReliabilityQueueStore } from "./queueTypes.js";

export interface QueueMonitorOptions {
  pendingThreshold?: number;
  deadLetterThreshold?: number;
  // Without a running worker, jobs never leave QUEUED on their own - the
  // store's TTL eviction is what bounds them, not processing. Treating that
  // as a "backlog" would be a false alarm about a queue nothing is meant to
  // be draining yet, so both alarms only evaluate when a worker is actually
  // enabled. Defaults to true so existing callers keep today's behavior.
  workersEnabled?: boolean;
}

export function queueBacklogSnapshot(
  store: ReliabilityQueueStore,
  options: QueueMonitorOptions = {},
): QueueBacklogSnapshot {
  const snapshot = store.counts();
  const pendingThreshold = options.pendingThreshold ?? 50;
  const deadLetterThreshold = options.deadLetterThreshold ?? 1;
  const workersEnabled = options.workersEnabled ?? true;
  return {
    ...snapshot,
    backlog_alarm: workersEnabled && snapshot.inbound_queue_pending + snapshot.outbound_queue_pending >= pendingThreshold,
    dead_letter_alarm: workersEnabled && snapshot.dead_letter_count >= deadLetterThreshold,
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
