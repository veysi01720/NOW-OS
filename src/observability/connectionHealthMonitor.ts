import { redactSecrets } from "../utils/redaction.js";
import type { Logger } from "./logger.js";
import type { QueueBacklogSnapshot } from "../reliability/queueTypes.js";
import { evaluateMigrationReadiness, type MigrationReadinessSnapshot } from "./migrationReadiness.js";

export interface ConnectionHealthSnapshot {
  evolution_instance: string;
  inbound_queue_mode: string;
  outbound_queue_mode: string;
  fast_ack_enabled: boolean;
  workers_enabled: boolean;
  behavior_tenant_canary_available: boolean;
  behavior_tenant_canary_enabled: boolean;
  behavior_tenant_canary_allowed_tenant_count: number;
  last_inbound_confirmed_at: string | null;
  last_send_confirmed_at: string | null;
  last_queue_write_at: string | null;
  last_queue_write_error: string | null;
  last_worker_pickup_at: string | null;
  last_worker_error: string | null;
  receiving_degraded: boolean;
  degraded_reason: string | null;
  recent_inbound_observation: boolean;
  recent_send_observation: boolean;
  degraded_threshold_seconds: number;
  last_reachability_check_at: string | null;
  last_reachability_ok: boolean | null;
  last_reachability_status: number | null;
  last_reachability_error: string | null;
  queue?: QueueBacklogSnapshot;
  migration_readiness?: MigrationReadinessSnapshot;
  recommended_action: string;
  diagnosis: string;
}

export interface ConnectionHealthMonitorOptions {
  evolutionInstance: string;
  evolutionApiBaseUrl: string;
  evolutionApiKey: string;
  logger: Logger;
  degradedThresholdMs?: number;
  reachabilityTimeoutMs?: number;
  queueSnapshotProvider?: () => QueueBacklogSnapshot;
  modeSnapshotProvider?: () => {
    inbound_queue_mode: string;
    outbound_queue_mode: string;
    fast_ack_enabled: boolean;
    workers_enabled: boolean;
    behavior_tenant_canary_available?: boolean;
    behavior_tenant_canary_enabled?: boolean;
    behavior_tenant_canary_allowed_tenant_count?: number;
  };
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

type ReachabilityReason = "startup" | "periodic" | "manual";

export class ConnectionHealthMonitor {
  private lastInboundConfirmedAt: Date | null = null;
  private lastSendConfirmedAt: Date | null = null;
  private lastReachabilityCheckAt: Date | null = null;
  private lastReachabilityOk: boolean | null = null;
  private lastReachabilityStatus: number | null = null;
  private lastReachabilityError: string | null = null;
  private lastQueueWriteAt: Date | null = null;
  private lastQueueWriteError: string | null = null;
  private lastWorkerPickupAt: Date | null = null;
  private lastWorkerError: string | null = null;

  private readonly degradedThresholdMs: number;
  private readonly reachabilityTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly options: ConnectionHealthMonitorOptions) {
    this.degradedThresholdMs = options.degradedThresholdMs ?? 10 * 60 * 1000;
    this.reachabilityTimeoutMs = options.reachabilityTimeoutMs ?? 3000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  recordInboundConfirmed(input: { correlation_id?: string; message_id?: string; chat_type?: string }): void {
    this.lastInboundConfirmedAt = this.now();
    const snapshot = this.snapshot();
    this.options.logger.info({
      event_type: "INBOUND_CONFIRMED",
      correlation_id: input.correlation_id,
      message_id: input.message_id,
      chat_type: input.chat_type,
      last_inbound_confirmed_at: snapshot.last_inbound_confirmed_at,
      receiving_degraded: snapshot.receiving_degraded,
    });
  }

  recordSendConfirmed(input: { correlation_id?: string; message_id?: string }): void {
    this.lastSendConfirmedAt = this.now();
    const snapshot = this.snapshot();
    this.options.logger.info({
      event_type: "SEND_CONFIRMED",
      correlation_id: input.correlation_id,
      message_id: input.message_id,
      last_send_confirmed_at: snapshot.last_send_confirmed_at,
      receiving_degraded: snapshot.receiving_degraded,
    });
  }

  recordQueueWrite(input: { queue_name: string; correlation_id?: string; success: boolean; error?: string }): void {
    this.lastQueueWriteAt = this.now();
    this.lastQueueWriteError = input.success ? null : redactSecrets(input.error ?? "queue_write_failed");
    this.options.logger[input.success ? "info" : "warn"]({
      event_type: input.success ? "QUEUE_WRITE_CONFIRMED" : "QUEUE_WRITE_FAILED",
      queue_name: input.queue_name,
      correlation_id: input.correlation_id,
      last_queue_write_at: this.lastQueueWriteAt.toISOString(),
      error: this.lastQueueWriteError,
    });
  }

  recordWorkerPickup(input: { queue_name: string; job_id?: string }): void {
    this.lastWorkerPickupAt = this.now();
    this.options.logger.info({
      event_type: "QUEUE_WORKER_PICKUP",
      queue_name: input.queue_name,
      job_id: input.job_id,
      last_worker_pickup_at: this.lastWorkerPickupAt.toISOString(),
    });
  }

  recordWorkerError(input: { queue_name: string; job_id?: string; error: string }): void {
    this.lastWorkerError = redactSecrets(input.error);
    this.options.logger.warn({
      event_type: "QUEUE_WORKER_ERROR",
      queue_name: input.queue_name,
      job_id: input.job_id,
      last_worker_error: this.lastWorkerError,
    });
  }

  snapshot(): ConnectionHealthSnapshot {
    const modes = this.options.modeSnapshotProvider?.() ?? {
      inbound_queue_mode: "off",
      outbound_queue_mode: "off",
      fast_ack_enabled: false,
      workers_enabled: false,
      behavior_tenant_canary_available: false,
      behavior_tenant_canary_enabled: false,
      behavior_tenant_canary_allowed_tenant_count: 0,
    };
    const receivingDegraded = this.isReceivingDegraded();
    const recentInboundObservation = this.isRecent(this.lastInboundConfirmedAt);
    const recentSendObservation = this.isRecent(this.lastSendConfirmedAt);
    const migrationReadiness = evaluateMigrationReadiness({
      last_reachability_ok: this.lastReachabilityOk,
      receiving_degraded: receivingDegraded,
      recent_inbound_observation: recentInboundObservation,
      recent_send_observation: recentSendObservation,
    });
    return {
      evolution_instance: this.options.evolutionInstance,
      behavior_tenant_canary_available: modes.behavior_tenant_canary_available ?? false,
      behavior_tenant_canary_enabled: modes.behavior_tenant_canary_enabled ?? false,
      behavior_tenant_canary_allowed_tenant_count: modes.behavior_tenant_canary_allowed_tenant_count ?? 0,
      ...modes,
      last_inbound_confirmed_at: this.lastInboundConfirmedAt?.toISOString() ?? null,
      last_send_confirmed_at: this.lastSendConfirmedAt?.toISOString() ?? null,
      last_queue_write_at: this.lastQueueWriteAt?.toISOString() ?? null,
      last_queue_write_error: this.lastQueueWriteError,
      last_worker_pickup_at: this.lastWorkerPickupAt?.toISOString() ?? null,
      last_worker_error: this.lastWorkerError,
      receiving_degraded: receivingDegraded,
      degraded_reason: this.degradedReason(),
      recent_inbound_observation: recentInboundObservation,
      recent_send_observation: recentSendObservation,
      degraded_threshold_seconds: Math.round(this.degradedThresholdMs / 1000),
      last_reachability_check_at: this.lastReachabilityCheckAt?.toISOString() ?? null,
      last_reachability_ok: this.lastReachabilityOk,
      last_reachability_status: this.lastReachabilityStatus,
      last_reachability_error: this.lastReachabilityError,
      queue: this.options.queueSnapshotProvider?.(),
      migration_readiness: migrationReadiness,
      recommended_action: this.recommendedAction(),
      diagnosis: this.diagnosis(),
    };
  }

  async runReachabilityCheck(reason: ReachabilityReason): Promise<ConnectionHealthSnapshot> {
    this.lastReachabilityCheckAt = this.now();
    this.lastReachabilityStatus = null;
    this.lastReachabilityError = null;

    try {
      const response = await this.fetchImpl(this.options.evolutionApiBaseUrl, {
        method: "GET",
        headers: {
          apikey: this.options.evolutionApiKey,
        },
        signal: AbortSignal.timeout(this.reachabilityTimeoutMs),
      });
      this.lastReachabilityStatus = response.status;
      this.lastReachabilityOk = response.status < 500;
    } catch (error) {
      this.lastReachabilityOk = false;
      this.lastReachabilityError = redactSecrets(error instanceof Error ? error.message : String(error));
    }

    const snapshot = this.snapshot();
    this.options.logger.info({
      event_type: "GATEWAY_REACHABILITY_CHECK",
      reason,
      evolution_instance: snapshot.evolution_instance,
      reachability_ok: snapshot.last_reachability_ok,
      http_status: snapshot.last_reachability_status,
      error: snapshot.last_reachability_error,
      receiving_degraded: snapshot.receiving_degraded,
    });
    if (snapshot.last_reachability_ok === false) {
      this.options.logger.warn({
        event_type: "INFRA_REACHABILITY_ALERT",
        reason,
        evolution_instance: snapshot.evolution_instance,
        reachability_ok: false,
        error: snapshot.last_reachability_error,
        receiving_degraded: snapshot.receiving_degraded,
      });
    }
    return snapshot;
  }

  private isRecent(value: Date | null): boolean {
    return value !== null && this.now().getTime() - value.getTime() <= this.degradedThresholdMs;
  }

  private isReceivingDegraded(): boolean {
    if (this.isRecent(this.lastInboundConfirmedAt)) {
      return false;
    }

    const outboundRecentlyConfirmed = this.isRecent(this.lastSendConfirmedAt);
    const gatewayReachable = this.lastReachabilityOk === true;

    return outboundRecentlyConfirmed || gatewayReachable;
  }

  private degradedReason(): string | null {
    if (!this.isReceivingDegraded()) return null;
    if (this.lastInboundConfirmedAt === null) {
      return "no_inbound_confirmed_yet";
    }
    if (!this.isRecent(this.lastInboundConfirmedAt) && this.isRecent(this.lastSendConfirmedAt)) {
      return "recent_send_but_no_recent_inbound";
    }
    if (!this.isRecent(this.lastInboundConfirmedAt) && this.lastReachabilityOk === true) {
      return "gateway_reachable_but_no_recent_inbound";
    }
    return "no_recent_inbound";
  }

  private diagnosis(): string {
    const snapshot = {
      receiving_degraded: this.isReceivingDegraded(),
      degraded_reason: this.degradedReason(),
      reachability_ok: this.lastReachabilityOk,
      queue: this.options.queueSnapshotProvider?.(),
    };
    if (snapshot.queue?.dead_letter_alarm) return "Queue has dead-letter jobs. Operator review is required.";
    if (snapshot.queue?.backlog_alarm) return "Queue backlog is above threshold. Worker capacity or gateway health should be checked.";
    if (snapshot.receiving_degraded) return `Inbound receiving is degraded: ${snapshot.degraded_reason ?? "unknown"}.`;
    if (snapshot.reachability_ok === false) return "Gateway reachability check is failing.";
    return "Connection appears healthy.";
  }

  private recommendedAction(): string {
    const snapshot = {
      receiving_degraded: this.isReceivingDegraded(),
      degraded_reason: this.degradedReason(),
      reachability_ok: this.lastReachabilityOk,
      queue: this.options.queueSnapshotProvider?.(),
      queue_error: this.lastQueueWriteError,
      worker_error: this.lastWorkerError,
    };
    if (snapshot.queue?.dead_letter_alarm) return "Review dead-letter jobs before cutover.";
    if (snapshot.queue?.backlog_alarm) return "Drain queue backlog or add worker capacity before cutover.";
    if (snapshot.queue_error) return "Inspect queue write failure and keep legacy flow active.";
    if (snapshot.worker_error) return "Inspect worker dry-run failure before enabling production workers.";
    if (snapshot.receiving_degraded) return `Repair inbound receiving before smoke or cutover: ${snapshot.degraded_reason ?? "unknown"}.`;
    if (snapshot.reachability_ok === false) return "Repair Evolution gateway reachability.";
    return "No operator action required.";
  }
}
