import { redactSecrets } from "../utils/redaction.js";
import type { Logger } from "./logger.js";
import type { QueueBacklogSnapshot } from "../reliability/queueTypes.js";
import { evaluateMigrationReadiness, type MigrationReadinessSnapshot } from "./migrationReadiness.js";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import {
  PersistentEvolutionConnectionControlStore,
  type EvolutionConnectionAlarmKind,
} from "./evolutionConnectionControlStore.js";
import type { ConnectionAlarmNotifier } from "./connectionAlarmNotifier.js";

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
  reconnect_cooldown_until?: string | null;
  reconnect_hard_stop_reason?: string | null;
  reconnect_attempts_last_30m?: number;
  connecting_since?: string | null;
  refused_since?: string | null;
  smtp_alarm_configured?: boolean;
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
  reconnectCooldownMs?: number;
  connectingTimeoutMs?: number;
  refusedRetryDelayMs?: number;
  stableOpenResetMs?: number;
  connectionControlStatePath?: string;
  logoutEventsPath?: string;
  sessionIntegrityCheck?: () => Promise<"nonempty" | "empty" | "unavailable" | "error">;
  onLogout401?: (input: { instance: string; reason: number }) => void;
  onConnectionAlarm?: (input: { kind: EvolutionConnectionAlarmKind; instance: string; statusReason?: number }) => void;
  alarmNotifier?: ConnectionAlarmNotifier;
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
  private readonly reconnectCooldownMs: number;
  private readonly connectingTimeoutMs: number;
  private readonly refusedRetryDelayMs: number;
  private readonly stableOpenResetMs: number;
  private readonly logoutEventsPath?: string;
  private readonly sessionIntegrityCheck?: ConnectionHealthMonitorOptions["sessionIntegrityCheck"];
  private readonly onLogout401?: ConnectionHealthMonitorOptions["onLogout401"];
  private readonly onConnectionAlarm?: ConnectionHealthMonitorOptions["onConnectionAlarm"];
  private readonly alarmNotifier?: ConnectionAlarmNotifier;
  private readonly controlStore: PersistentEvolutionConnectionControlStore;
  private evolutionConnectionState: string | null = null;
  private sessionIntegrity: "nonempty" | "empty" | "unavailable" | "error" = "unavailable";
  private reconnectInProgress = false;
  private logoutEvents: string[] = [];

  constructor(private readonly options: ConnectionHealthMonitorOptions) {
    this.degradedThresholdMs = options.degradedThresholdMs ?? 10 * 60 * 1000;
    this.reachabilityTimeoutMs = options.reachabilityTimeoutMs ?? 3000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.autoReconnectEnabled = options.autoReconnectEnabled ?? false;
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? 5_000;
    this.reconnectCooldownMs = options.reconnectCooldownMs ?? 60 * 60 * 1000;
    this.connectingTimeoutMs = options.connectingTimeoutMs ?? 5 * 60 * 1000;
    this.refusedRetryDelayMs = options.refusedRetryDelayMs ?? 10 * 60 * 1000;
    this.stableOpenResetMs = options.stableOpenResetMs ?? 2 * 60 * 1000;
    this.logoutEventsPath = options.logoutEventsPath;
    this.sessionIntegrityCheck = options.sessionIntegrityCheck;
    this.onLogout401 = options.onLogout401;
    this.onConnectionAlarm = options.onConnectionAlarm;
    this.alarmNotifier = options.alarmNotifier;
    this.controlStore = new PersistentEvolutionConnectionControlStore(options.connectionControlStatePath, this.now);
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
    const connectionControl = this.controlStore.snapshot();
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
      reconnect_attempt: connectionControl.attempt_timestamps.length,
      reconnect_attempts_last_30m: connectionControl.attempt_timestamps.length,
      reconnect_cooldown_until: connectionControl.cooldown_until,
      reconnect_hard_stop_reason: connectionControl.hard_stop_reason,
      connecting_since: connectionControl.connecting_since,
      refused_since: connectionControl.refused_since,
      smtp_alarm_configured: this.alarmNotifier?.isConfigured() === true,
      logout_401_count_last_24h: this.recentLogoutCount(),
      session_integrity: this.sessionIntegrity,
    };
  }

  recordEvolutionConnectionUpdate(input: { state?: string; statusReason?: number }): void {
    this.observeConnectionState(input, true);
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

  private observeConnectionState(input: { state?: string; statusReason?: number }, countRefusedEvent: boolean): void {
    const state = input.state ?? null;
    const nowIso = this.now().toISOString();
    this.evolutionConnectionState = state;
    const before = this.controlStore.snapshot();

    if (state === "open") {
      this.controlStore.update((control) => {
        if (control.last_state !== "open" || control.open_since === null) control.open_since = nowIso;
        control.last_state = "open";
        control.connecting_since = null;
        control.refused_since = null;
        control.refused_attempted = false;
        control.connecting_attempted = false;
      });
      void this.resetAfterStableOpenIfEligible();
      return;
    }

    if (state === "connecting") {
      this.controlStore.update((control) => {
        if (control.last_state !== "connecting" || control.connecting_since === null) {
          control.connecting_since = nowIso;
          control.connecting_attempted = false;
        }
        control.last_state = "connecting";
        control.open_since = null;
        control.incident_active = true;
      });
      void this.requestAutomaticConnect("connecting_timeout");
      return;
    }

    if (state === "close" && input.statusReason === 401) {
      this.controlStore.update((control) => {
        control.last_state = "close_401";
        control.hard_stop_reason = "logged_out_401";
        control.open_since = null;
        control.incident_active = true;
      });
      if (before.hard_stop_reason !== "logged_out_401") {
        this.recordLogout401();
      }
      void this.emitAlarm("logged_out_401", 401);
      this.options.logger.warn({
        event_type: "EVOLUTION_RECONNECT_HARD_STOP",
        evolution_instance: this.options.evolutionInstance,
        status_reason: 401,
        automatic_reconnect_allowed: false,
      });
      return;
    }

    if ((state === "close" || state === "refused") && input.statusReason === 428) {
      this.controlStore.update((control) => {
        if (control.last_state !== "close_428" || control.refused_since === null) {
          control.refused_since = nowIso;
          control.refused_attempted = false;
        }
        control.last_state = "close_428";
        control.open_since = null;
        control.incident_active = true;
        if (countRefusedEvent) control.refused_event_count += 1;
      });
      const after = this.controlStore.snapshot();
      if (after.refused_event_count >= 2) void this.emitAlarm("repeated_refused_428", 428);
      void this.requestAutomaticConnect("refused_428");
      return;
    }

    this.controlStore.update((control) => {
      control.last_state = state;
      control.open_since = null;
    });
  }

  private async requestAutomaticConnect(trigger: "refused_428" | "connecting_timeout"): Promise<void> {
    if (!this.autoReconnectEnabled) return;
    const control = this.controlStore.snapshot();
    if (control.hard_stop_reason) return;
    const nowMs = this.now().getTime();
    if (trigger === "refused_428") {
      if (control.refused_attempted || control.refused_since === null || nowMs - Date.parse(control.refused_since) < this.refusedRetryDelayMs) return;
    } else if (control.connecting_attempted || control.connecting_since === null || nowMs - Date.parse(control.connecting_since) < this.connectingTimeoutMs) {
      return;
    }
    await this.requestOperation("connect", trigger, false);
  }

  async requestManualOperation(operation: "connect" | "logout"): Promise<{ ok: boolean; status: number; reason: string }> {
    return this.requestOperation(operation, "owner_manual", true);
  }

  async sendAlarmTest(): Promise<{ delivered: boolean }> {
    const result = await this.alarmNotifier?.send({
      kind: "connection_recovered",
      instance: this.options.evolutionInstance,
      state: this.evolutionConnectionState,
      occurred_at: this.now().toISOString(),
    });
    return { delivered: result?.delivered === true };
  }

  private async requestOperation(
    operation: "connect" | "logout",
    trigger: "refused_428" | "connecting_timeout" | "owner_manual",
    manual: boolean,
  ): Promise<{ ok: boolean; status: number; reason: string }> {
    if (this.reconnectInProgress) return { ok: false, status: 409, reason: "operation_in_progress" };
    const control = this.controlStore.snapshot();
    const nowMs = this.now().getTime();
    if (!manual && control.hard_stop_reason) return { ok: false, status: 423, reason: "hard_stop_401" };
    if (control.cooldown_until && nowMs < Date.parse(control.cooldown_until)) {
      this.options.logger.warn({ event_type: "EVOLUTION_RECONNECT_COOLDOWN_ACTIVE", evolution_instance: this.options.evolutionInstance });
      await this.emitAlarm("circuit_breaker_open");
      return { ok: false, status: 429, reason: "circuit_breaker_cooldown" };
    }
    if (control.attempt_timestamps.length >= 2) {
      this.controlStore.openCircuit(this.reconnectCooldownMs);
      await this.emitAlarm("circuit_breaker_open");
      this.options.logger.warn({
        event_type: "EVOLUTION_RECONNECT_HALTED",
        evolution_instance: this.options.evolutionInstance,
        reason: "max_2_attempts_in_30m",
        cooldown_minutes: Math.round(this.reconnectCooldownMs / 60_000),
      });
      return { ok: false, status: 429, reason: "circuit_breaker_open" };
    }

    this.reconnectInProgress = true;
    const attempt = this.controlStore.recordAttempt().attempt_timestamps.length;
    this.controlStore.update((state) => {
      if (trigger === "refused_428") state.refused_attempted = true;
      if (trigger === "connecting_timeout") state.connecting_attempted = true;
    });
    if (this.reconnectBaseDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.reconnectBaseDelayMs));
    const endpoint = operation === "connect" ? "connect" : "logout";
    const method = operation === "connect" ? "GET" : "DELETE";
    try {
      const response = await this.fetchImpl(`${this.options.evolutionApiBaseUrl.replace(/\/$/u, "")}/instance/${endpoint}/${encodeURIComponent(this.options.evolutionInstance)}`, {
        method,
        headers: { apikey: this.options.evolutionApiKey },
        signal: AbortSignal.timeout(this.reachabilityTimeoutMs),
      });
      this.options.logger[response.ok ? "info" : "warn"]({
        event_type: response.ok ? "EVOLUTION_CONNECTION_OPERATION_REQUESTED" : "EVOLUTION_CONNECTION_OPERATION_FAILED",
        evolution_instance: this.options.evolutionInstance,
        operation,
        attempt,
        trigger,
        http_status: response.status,
      });
      return { ok: response.ok, status: response.status, reason: response.ok ? "requested" : "evolution_rejected" };
    } catch (error) {
      this.options.logger.warn({
        event_type: "EVOLUTION_CONNECTION_OPERATION_FAILED",
        evolution_instance: this.options.evolutionInstance,
        operation,
        attempt,
        trigger,
        error: redactSecrets(error instanceof Error ? error.message : String(error)),
      });
      return { ok: false, status: 502, reason: "evolution_unreachable" };
    } finally {
      this.reconnectInProgress = false;
    }
  }

  private async emitAlarm(kind: EvolutionConnectionAlarmKind, statusReason?: number): Promise<boolean> {
    const control = this.controlStore.snapshot();
    if (control.alarms_sent.includes(kind)) return true;
    this.onConnectionAlarm?.({ kind, instance: this.options.evolutionInstance, statusReason });
    const result = await this.alarmNotifier?.send({
      kind,
      instance: this.options.evolutionInstance,
      state: this.evolutionConnectionState,
      status_reason: statusReason,
      occurred_at: this.now().toISOString(),
    });
    if (result?.delivered) {
      this.controlStore.markAlarmSent(kind);
      return true;
    }
    return false;
  }

  private async resetAfterStableOpenIfEligible(): Promise<void> {
    const control = this.controlStore.snapshot();
    if (control.open_since === null || this.now().getTime() - Date.parse(control.open_since) < this.stableOpenResetMs) return;
    const recoveryAlarmDelivered = control.incident_active
      ? await this.emitAlarm("connection_recovered")
      : true;
    this.controlStore.resetAfterStableOpen(recoveryAlarmDelivered);
    this.options.logger.info({
      event_type: "EVOLUTION_CONNECTION_STABLE_OPEN",
      evolution_instance: this.options.evolutionInstance,
      stable_seconds: Math.round(this.stableOpenResetMs / 1000),
      breaker_reset: true,
    });
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
      this.observeConnectionState({
        state: body.instance?.state ?? body.state,
        statusReason: body.instance?.statusReason ?? body.statusReason,
      }, false);
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
