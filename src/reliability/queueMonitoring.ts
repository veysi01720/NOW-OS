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
  // The legacy webhook path has already handled dual-write inbound records.
  // Expose their count separately without treating them as actionable work.
  inboundShadowOnly?: boolean;
}

export function queueBacklogSnapshot(
  store: ReliabilityQueueStore,
  options: QueueMonitorOptions = {},
): QueueBacklogSnapshot {
  const snapshot = store.counts();
  const pendingThreshold = options.pendingThreshold ?? 50;
  const deadLetterThreshold = options.deadLetterThreshold ?? 1;
  const workersEnabled = options.workersEnabled ?? true;
  const inboundShadowOnly = options.inboundShadowOnly ?? false;
  const inboundQueuePending = inboundShadowOnly ? 0 : snapshot.inbound_queue_pending;
  const inboundShadowPending = inboundShadowOnly ? snapshot.inbound_queue_pending : 0;
  return {
    ...snapshot,
    inbound_queue_pending: inboundQueuePending,
    inbound_shadow_pending: inboundShadowPending,
    backlog_alarm: workersEnabled && inboundQueuePending + snapshot.outbound_queue_pending >= pendingThreshold,
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
