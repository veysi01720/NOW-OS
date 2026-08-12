import { redactSecrets } from "../utils/redaction.js";
import type { Logger } from "./logger.js";
import type { QueueBacklogSnapshot } from "../reliability/queueTypes.js";
import { evaluateMigrationReadiness, type MigrationReadinessSnapshot } from "./migrationReadiness.js";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";

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
  shadow_queue_stats: {
    inbound: ShadowQueueWriteStats;
    outbound: ShadowQueueWriteStats;
  };
  recommended_action: string;
  diagnosis: string;
  evolution_connection_state?: string | null;
  reconnect_in_progress?: boolean;
  reconnect_attempt?: number;
  logout_401_count_last_24h?: number;
  session_integrity?: "nonempty" | "empty" | "unavailable" | "error";
}

export interface ShadowQueueWriteStats {
  success_count: number;
  failure_count: number;
  error_rate: number;
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
  autoReconnectEnabled?: boolean;
  reconnectBaseDelayMs?: number;
  logoutEventsPath?: string;
  sessionIntegrityCheck?: () => Promise<"nonempty" | "empty" | "unavailable" | "error">;
  onLogout401?: (input: { instance: string; reason: number }) => void;
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
  private readonly shadowQueueWriteCounts: Record<string, { success: number; failure: number }> = {
    inbound: { success: 0, failure: 0 },
    outbound: { success: 0, failure: 0 },
  };

  private readonly degradedThresholdMs: number;
  private readonly reachabilityTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly autoReconnectEnabled: boolean;
  private readonly reconnectBaseDelayMs: number;
  private readonly logoutEventsPath?: string;
  private readonly sessionIntegrityCheck?: ConnectionHealthMonitorOptions["sessionIntegrityCheck"];
  private readonly onLogout401?: ConnectionHealthMonitorOptions["onLogout401"];
  private evolutionConnectionState: string | null = null;
  private sessionIntegrity: "nonempty" | "empty" | "unavailable" | "error" = "unavailable";
  private reconnectInProgress = false;
  private reconnectAttempt = 0;
  private reconnectWindowStartedAt: number | null = null;
  private logoutEvents: string[] = [];

  constructor(private readonly options: ConnectionHealthMonitorOptions) {
    this.degradedThresholdMs = options.degradedThresholdMs ?? 10 * 60 * 1000;
    this.reachabilityTimeoutMs = options.reachabilityTimeoutMs ?? 3000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.autoReconnectEnabled = options.autoReconnectEnabled ?? false;
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? 5_000;
    this.logoutEventsPath = options.logoutEventsPath;
    this.sessionIntegrityCheck = options.sessionIntegrityCheck;
    this.onLogout401 = options.onLogout401;
    this.loadLogoutEvents();
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
    const counts = this.shadowQueueWriteCounts[input.queue_name];
    if (counts) {
      if (input.success) counts.success += 1;
      else counts.failure += 1;
    }
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
      shadow_queue_stats: {
        inbound: this.shadowQueueStatsFor("inbound"),
        outbound: this.shadowQueueStatsFor("outbound"),
      },
      recommended_action: this.recommendedAction(),
      diagnosis: this.diagnosis(),
      evolution_connection_state: this.evolutionConnectionState,
      reconnect_in_progress: this.reconnectInProgress,
      reconnect_attempt: this.reconnectAttempt,
      logout_401_count_last_24h: this.recentLogoutCount(),
      session_integrity: this.sessionIntegrity,
    };
  }

  recordEvolutionConnectionUpdate(input: { state?: string; statusReason?: number }): void {
    this.evolutionConnectionState = input.state ?? null;
    if (input.state === "open") {
      this.reconnectAttempt = 0;
      this.reconnectWindowStartedAt = null;
      return;
    }
    if (input.state === "close" && input.statusReason === 401) {
      this.recordLogout401();
    }
    if (input.state === "close") void this.reconnectIfClosed();
  }

  private loadLogoutEvents(): void {
    if (!this.logoutEventsPath) return;
    try {
      const parsed = JSON.parse(readFileSync(this.logoutEventsPath, "utf8")) as unknown;
      this.logoutEvents = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
    } catch { this.logoutEvents = []; }
    this.pruneLogoutEvents(false);
  }

  private recentLogoutCount(): number {
    this.pruneLogoutEvents(false);
    return this.logoutEvents.length;
  }

  private pruneLogoutEvents(save: boolean): void {
    const cutoff = this.now().getTime() - 24 * 60 * 60 * 1000;
    this.logoutEvents = this.logoutEvents.filter((value) => Date.parse(value) >= cutoff);
    if (save && this.logoutEventsPath) {
      mkdirSync(dirname(this.logoutEventsPath), { recursive: true });
      const temp = `${this.logoutEventsPath}.tmp`;
      writeFileSync(temp, JSON.stringify(this.logoutEvents), { mode: 0o600 });
      renameSync(temp, this.logoutEventsPath);
    }
  }

  private recordLogout401(): void {
    this.logoutEvents.push(this.now().toISOString());
    this.pruneLogoutEvents(true);
    this.options.logger.warn({ event_type: "EVOLUTION_SESSION_LOGOUT_401", evolution_instance: this.options.evolutionInstance, logout_401_count_last_24h: this.logoutEvents.length });
    this.onLogout401?.({ instance: this.options.evolutionInstance, reason: 401 });
  }

  private async reconnectIfClosed(): Promise<void> {
    if (!this.autoReconnectEnabled || this.reconnectInProgress || this.evolutionConnectionState !== "close") return;
    const nowMs = this.now().getTime();
    if (this.reconnectWindowStartedAt === null || nowMs - this.reconnectWindowStartedAt > 60 * 60 * 1000) {
      this.reconnectWindowStartedAt = nowMs;
      this.reconnectAttempt = 0;
    }
    if (this.reconnectAttempt >= 3) {
      this.options.logger.warn({ event_type: "EVOLUTION_RECONNECT_HALTED", evolution_instance: this.options.evolutionInstance, reason: "max_attempts_per_hour" });
      return;
    }
    this.reconnectInProgress = true;
    const attempt = ++this.reconnectAttempt;
    const delay = Math.min(this.reconnectBaseDelayMs * 2 ** Math.max(0, attempt - 1), 5 * 60 * 1000);
    await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const response = await this.fetchImpl(`${this.options.evolutionApiBaseUrl.replace(/\/$/u, "")}/instance/connect/${encodeURIComponent(this.options.evolutionInstance)}`, {
        method: "GET", headers: { apikey: this.options.evolutionApiKey }, signal: AbortSignal.timeout(this.reachabilityTimeoutMs),
      });
      this.options.logger.info({ event_type: response.ok ? "EVOLUTION_RECONNECT_REQUESTED" : "EVOLUTION_RECONNECT_FAILED", evolution_instance: this.options.evolutionInstance, attempt, http_status: response.status });
    } catch (error) {
      this.options.logger.warn({ event_type: "EVOLUTION_RECONNECT_FAILED", evolution_instance: this.options.evolutionInstance, attempt, error: redactSecrets(error instanceof Error ? error.message : String(error)) });
    } finally { this.reconnectInProgress = false; }
  }

  private shadowQueueStatsFor(queueName: string): ShadowQueueWriteStats {
    const counts = this.shadowQueueWriteCounts[queueName] ?? { success: 0, failure: 0 };
    const total = counts.success + counts.failure;
    return {
      success_count: counts.success,
      failure_count: counts.failure,
      error_rate: total === 0 ? 0 : counts.failure / total,
    };
  }

  async runReachabilityCheck(reason: ReachabilityReason): Promise<ConnectionHealthSnapshot> {
    this.lastReachabilityCheckAt = this.now();
    this.lastReachabilityStatus = null;
    this.lastReachabilityError = null;

    try {
      const response = await this.fetchImpl(`${this.options.evolutionApiBaseUrl.replace(/\/$/u, "")}/instance/connectionState/${encodeURIComponent(this.options.evolutionInstance)}`, {
        method: "GET",
        headers: {
          apikey: this.options.evolutionApiKey,
        },
        signal: AbortSignal.timeout(this.reachabilityTimeoutMs),
      });
      this.lastReachabilityStatus = response.status;
      this.lastReachabilityOk = response.status < 500;
      const body = await response.clone().json().catch(() => ({})) as { instance?: { state?: string; statusReason?: number }; state?: string; statusReason?: number };
      this.evolutionConnectionState = body.instance?.state ?? body.state ?? null;
      if (this.evolutionConnectionState === "close") void this.reconnectIfClosed();
      if (body.instance?.state === "close" && body.instance.statusReason === 401) {
        this.recordLogout401();
      }
    } catch (error) {
      this.lastReachabilityOk = false;
      this.lastReachabilityError = redactSecrets(error instanceof Error ? error.message : String(error));
    }

    if (this.sessionIntegrityCheck) {
      this.sessionIntegrity = await this.sessionIntegrityCheck();
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
