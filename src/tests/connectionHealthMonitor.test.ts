import { ConnectionHealthMonitor } from "../observability/connectionHealthMonitor.js";
import { createSilentLogger } from "./testDoubles.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("ConnectionHealthMonitor", () => {
  it("records inbound and send confirmation timestamps without raw identifiers", () => {
    const logger = createSilentLogger();
    let current = new Date("2026-07-10T10:00:00.000Z");
    const monitor = new ConnectionHealthMonitor({
      evolutionInstance: "nowakademi_bot",
      evolutionApiBaseUrl: "http://evolution.local",
      evolutionApiKey: "secret-key",
      logger,
      now: () => current,
    });

    monitor.recordSendConfirmed({
      correlation_id: "corr_test",
      message_id: "msg_test",
    });
    current = new Date("2026-07-10T10:01:00.000Z");
    monitor.recordInboundConfirmed({
      correlation_id: "corr_inbound",
      message_id: "msg_inbound",
      chat_type: "private",
    });

    const snapshot = monitor.snapshot();
    expect(snapshot.last_send_confirmed_at).toBe("2026-07-10T10:00:00.000Z");
    expect(snapshot.last_inbound_confirmed_at).toBe("2026-07-10T10:01:00.000Z");
    expect(snapshot.receiving_degraded).toBe(false);
    expect(snapshot.recent_inbound_observation).toBe(true);
    expect(snapshot.recent_send_observation).toBe(true);
    expect(snapshot.degraded_reason).toBeNull();
    expect(JSON.stringify(logger.events)).not.toContain("secret-key");
    expect(JSON.stringify(logger.events)).not.toContain("@s.whatsapp.net");
    expect(JSON.stringify(logger.events)).not.toContain("@g.us");
  });

  it("marks receiving as degraded when sends are recent but inbound is stale", () => {
    const logger = createSilentLogger();
    let current = new Date("2026-07-10T10:00:00.000Z");
    const monitor = new ConnectionHealthMonitor({
      evolutionInstance: "nowakademi_bot",
      evolutionApiBaseUrl: "http://evolution.local",
      evolutionApiKey: "secret-key",
      logger,
      degradedThresholdMs: 60_000,
      now: () => current,
    });

    monitor.recordInboundConfirmed({ correlation_id: "corr_old" });
    current = new Date("2026-07-10T10:02:00.000Z");
    monitor.recordSendConfirmed({ correlation_id: "corr_send" });

    expect(monitor.snapshot().receiving_degraded).toBe(true);
    expect(monitor.snapshot().degraded_reason).toBe("recent_send_but_no_recent_inbound");
  });

  it("records startup reachability checks without logging the API key", async () => {
    const logger = createSilentLogger();
    const fetchCalls: Array<{ headers: HeadersInit | undefined }> = [];
    const monitor = new ConnectionHealthMonitor({
      evolutionInstance: "nowakademi_bot",
      evolutionApiBaseUrl: "http://evolution.local",
      evolutionApiKey: "secret-key",
      logger,
      fetchImpl: (async (_url, init) => {
        fetchCalls.push({ headers: init?.headers });
        return new Response("ok", { status: 200 });
      }) as typeof fetch,
      now: () => new Date("2026-07-10T10:00:00.000Z"),
    });

    const snapshot = await monitor.runReachabilityCheck("startup");

    expect(snapshot.last_reachability_ok).toBe(true);
    expect(fetchCalls[0]?.headers).toEqual({ apikey: "secret-key" });
    expect(logger.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "GATEWAY_REACHABILITY_CHECK",
          reason: "startup",
          reachability_ok: true,
        }),
      ]),
    );
    expect(JSON.stringify(logger.events)).not.toContain("secret-key");
  });

  it("logs a sanitized infra alert when reachability fails", async () => {
    const logger = createSilentLogger();
    const monitor = new ConnectionHealthMonitor({
      evolutionInstance: "nowakademi_bot",
      evolutionApiBaseUrl: "http://evolution.local",
      evolutionApiKey: "secret-key",
      logger,
      fetchImpl: (async () => {
        throw new Error("connect ECONNREFUSED Bearer sk-12345678901234567890");
      }) as typeof fetch,
      now: () => new Date("2026-07-10T10:00:00.000Z"),
    });

    const snapshot = await monitor.runReachabilityCheck("periodic");

    expect(snapshot.last_reachability_ok).toBe(false);
    expect(logger.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "WARN",
          event_type: "INFRA_REACHABILITY_ALERT",
          reason: "periodic",
          reachability_ok: false,
        }),
      ]),
    );
    expect(JSON.stringify(logger.events)).not.toContain("sk-12345678901234567890");
  });

  it("tracks shadow queue write success/failure counts and error rate per queue, observable via snapshot", () => {
    const logger = createSilentLogger();
    const monitor = new ConnectionHealthMonitor({
      evolutionInstance: "nowakademi_bot",
      evolutionApiBaseUrl: "http://evolution.local",
      evolutionApiKey: "secret-key",
      logger,
      now: () => new Date("2026-07-24T10:00:00.000Z"),
    });

    monitor.recordQueueWrite({ queue_name: "inbound", correlation_id: "corr_1", success: true });
    monitor.recordQueueWrite({ queue_name: "inbound", correlation_id: "corr_2", success: true });
    monitor.recordQueueWrite({ queue_name: "inbound", correlation_id: "corr_3", success: false, error: "store unavailable" });
    monitor.recordQueueWrite({ queue_name: "outbound", correlation_id: "corr_4", success: true });

    const snapshot = monitor.snapshot();
    expect(snapshot.shadow_queue_stats.inbound).toEqual({
      success_count: 2,
      failure_count: 1,
      error_rate: 1 / 3,
    });
    expect(snapshot.shadow_queue_stats.outbound).toEqual({
      success_count: 1,
      failure_count: 0,
      error_rate: 0,
    });
  });

  it("waits ten minutes after 428 and requests exactly one reconnect", async () => {
    const logger = createSilentLogger();
    const calls: string[] = [];
    let nowMs = Date.parse("2026-08-20T10:00:00.000Z");
    const monitor = new ConnectionHealthMonitor({
      evolutionInstance: "nowakademi_bot",
      evolutionApiBaseUrl: "http://evolution.local",
      evolutionApiKey: "secret-key",
      logger,
      autoReconnectEnabled: true,
      reconnectBaseDelayMs: 1,
      refusedRetryDelayMs: 10 * 60 * 1000,
      now: () => new Date(nowMs),
      fetchImpl: (async (url) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ instance: { state: "close", statusReason: 428 } }), { status: 200 });
      }) as typeof fetch,
    });
    await monitor.runReachabilityCheck("periodic");
    expect(calls).toHaveLength(1);
    nowMs += 10 * 60 * 1000 + 1;
    await monitor.runReachabilityCheck("periodic");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await monitor.runReachabilityCheck("periodic");
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(calls.filter((url) => url.includes("/instance/connect/"))).toHaveLength(1);
    expect(JSON.stringify(logger.events)).not.toContain("secret-key");
  });

  it("reconnects after a connecting state exceeds its timeout", async () => {
    const logger = createSilentLogger();
    const calls: string[] = [];
    let nowMs = Date.parse("2026-08-12T00:00:00.000Z");
    const monitor = new ConnectionHealthMonitor({
      evolutionInstance: "nowakademi_bot",
      evolutionApiBaseUrl: "http://evolution.local",
      evolutionApiKey: "secret-key",
      logger,
      autoReconnectEnabled: true,
      reconnectBaseDelayMs: 1,
      connectingTimeoutMs: 90_000,
      now: () => new Date(nowMs),
      fetchImpl: (async (url) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ instance: { state: "connecting" } }), { status: 200 });
      }) as typeof fetch,
    });

    monitor.recordEvolutionConnectionUpdate({ state: "connecting" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(calls).toHaveLength(0);

    nowMs += 90_001;
    monitor.recordEvolutionConnectionUpdate({ state: "connecting" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toContain("http://evolution.local/instance/connect/nowakademi_bot");
    expect(JSON.stringify(logger.events)).toContain("connecting_timeout");
  });

  it("persists and reports 401 logout counts without exposing payloads", async () => {
    const logger = createSilentLogger();
    const dir = mkdtempSync(join(tmpdir(), "now-os-logout-"));
    const path = join(dir, "events.json");
    const monitor = new ConnectionHealthMonitor({
      evolutionInstance: "nowakademi_bot",
      evolutionApiBaseUrl: "http://evolution.local",
      evolutionApiKey: "secret-key",
      logger,
      logoutEventsPath: path,
      fetchImpl: (async () => new Response(JSON.stringify({ instance: { state: "close", statusReason: 401 } }), { status: 200 })) as typeof fetch,
    });
    const snapshot = await monitor.runReachabilityCheck("periodic");
    expect(snapshot.logout_401_count_last_24h).toBe(1);
    expect(logger.events).toEqual(expect.arrayContaining([expect.objectContaining({ event_type: "EVOLUTION_SESSION_LOGOUT_401" })]));
    rmSync(dir, { recursive: true, force: true });
  });

  it("persists the two-attempt breaker across monitor restarts and opens a sixty-minute cooldown", async () => {
    const logger = createSilentLogger();
    const calls: string[] = [];
    let nowMs = Date.parse("2026-08-12T00:00:00.000Z");
    const dir = mkdtempSync(join(tmpdir(), "now-os-breaker-"));
    const statePath = join(dir, "control.json");
    const options = {
      evolutionInstance: "nowakademi_bot",
      evolutionApiBaseUrl: "http://evolution.local",
      evolutionApiKey: "secret-key",
      logger,
      autoReconnectEnabled: true,
      reconnectBaseDelayMs: 1,
      reconnectCooldownMs: 60 * 60 * 1000,
      connectionControlStatePath: statePath,
      now: () => new Date(nowMs),
      fetchImpl: (async (url) => {
        calls.push(String(url));
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    };
    const monitor = new ConnectionHealthMonitor(options);

    expect((await monitor.requestManualOperation("connect")).ok).toBe(true);
    expect((await monitor.requestManualOperation("connect")).ok).toBe(true);
    const restartedMonitor = new ConnectionHealthMonitor(options);
    const blocked = await restartedMonitor.requestManualOperation("connect");

    expect(blocked).toMatchObject({ ok: false, status: 429, reason: "circuit_breaker_open" });
    expect(calls).toHaveLength(2);
    expect(restartedMonitor.snapshot().reconnect_cooldown_until).toBe("2026-08-12T01:00:00.000Z");
    rmSync(dir, { recursive: true, force: true });
  });

  it("hard-stops on 401, never auto-reconnects, and dispatches the independent alarm", async () => {
    const logger = createSilentLogger();
    const calls: string[] = [];
    const alarms: string[] = [];
    const monitor = new ConnectionHealthMonitor({
      evolutionInstance: "nowakademi_bot",
      evolutionApiBaseUrl: "http://evolution.local",
      evolutionApiKey: "secret-key",
      logger,
      autoReconnectEnabled: true,
      reconnectBaseDelayMs: 1,
      alarmNotifier: {
        isConfigured: () => true,
        send: async (input) => {
          alarms.push(input.kind);
          return { delivered: true, message_id: "smtp-accepted" };
        },
      },
      fetchImpl: (async (url) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ instance: { state: "close", statusReason: 401 } }), { status: 200 });
      }) as typeof fetch,
    });

    await monitor.runReachabilityCheck("periodic");
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(calls.filter((url) => url.includes("/instance/connect/"))).toHaveLength(0);
    expect(alarms).toEqual(["logged_out_401"]);
    expect(monitor.snapshot().reconnect_hard_stop_reason).toBe("logged_out_401");
  });

  it("clears the persistent breaker only after open remains stable for two minutes", async () => {
    const logger = createSilentLogger();
    let nowMs = Date.parse("2026-08-20T10:00:00.000Z");
    const monitor = new ConnectionHealthMonitor({
      evolutionInstance: "nowakademi_bot",
      evolutionApiBaseUrl: "http://evolution.local",
      evolutionApiKey: "secret-key",
      logger,
      reconnectBaseDelayMs: 1,
      stableOpenResetMs: 2 * 60 * 1000,
      now: () => new Date(nowMs),
      alarmNotifier: {
        isConfigured: () => true,
        send: async () => ({ delivered: true }),
      },
      fetchImpl: (async () => new Response("{}", { status: 200 })) as typeof fetch,
    });

    await monitor.requestManualOperation("connect");
    monitor.recordEvolutionConnectionUpdate({ state: "open" });
    expect(monitor.snapshot().reconnect_attempts_last_30m).toBe(1);

    nowMs += 119_999;
    monitor.recordEvolutionConnectionUpdate({ state: "open" });
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(monitor.snapshot().reconnect_attempts_last_30m).toBe(1);

    nowMs += 2;
    monitor.recordEvolutionConnectionUpdate({ state: "open" });
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(monitor.snapshot().reconnect_attempts_last_30m).toBe(0);
  });

  it("retains session integrity in the connection-doctor snapshot", async () => {
    const logger = createSilentLogger();
    const monitor = new ConnectionHealthMonitor({
      evolutionInstance: "nowakademi_bot",
      evolutionApiBaseUrl: "http://evolution.local",
      evolutionApiKey: "secret-key",
      logger,
      sessionIntegrityCheck: async () => "nonempty",
      fetchImpl: (async () => new Response(JSON.stringify({ instance: { state: "open" } }), { status: 200 })) as typeof fetch,
    });
    const snapshot = await monitor.runReachabilityCheck("startup");
    expect(snapshot.session_integrity).toBe("nonempty");
  });

  it("reconciles a missing webhook from the Evolution message store without raising a false alarm", async () => {
    const logger = createSilentLogger();
    const alarms: string[] = [];
    const recovered: unknown[] = [];
    const monitor = new ConnectionHealthMonitor({
      evolutionInstance: "nowakademi_bot",
      evolutionApiBaseUrl: "http://evolution.local",
      evolutionApiKey: "secret-key",
      logger,
      inboundUpdateGraceMs: 1,
      alarmNotifier: {
        isConfigured: () => true,
        send: async (input) => {
          alarms.push(input.kind);
          return { delivered: true };
        },
      },
      fetchImpl: (async (url) => {
        if (String(url).includes("/chat/findMessages/")) {
          return new Response(JSON.stringify({
            messages: {
              records: [{
                key: { id: "msg_recovered", fromMe: false, remoteJid: "905000000000@s.whatsapp.net" },
                messageType: "conversation",
                message: { conversation: "hello" },
              }],
            },
          }), { status: 200 });
        }
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });

    monitor.recordInboundMessageUpdate({
      message_id: "msg_recovered",
      status: 4,
      known: false,
      process_recovered: async (payload) => {
        recovered.push(payload);
        monitor.recordInboundConfirmed({ message_id: "msg_recovered", chat_type: "private" });
        return true;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(recovered).toHaveLength(1);
    expect(alarms).toEqual([]);
    expect(monitor.snapshot()).toMatchObject({
      receiving_degraded: false,
      inbound_deaf_suspected: false,
      last_reconciliation_status: "found",
    });
    expect(JSON.stringify(logger.events)).not.toContain("905000000000");
    expect(JSON.stringify(logger.events)).not.toContain("hello");
  });

  it("persists an unrecoverable inbound loss, alarms, and permits only one breaker-controlled soft reconnect", async () => {
    const logger = createSilentLogger();
    const dir = mkdtempSync(join(tmpdir(), "now-os-deaf-"));
    const statePath = join(dir, "control.json");
    const calls: string[] = [];
    const alarms: string[] = [];
    let nowMs = Date.parse("2026-08-21T00:00:00.000Z");
    const options = {
      evolutionInstance: "nowakademi_bot",
      evolutionApiBaseUrl: "http://evolution.local",
      evolutionApiKey: "secret-key",
      logger,
      now: () => new Date(nowMs),
      autoReconnectEnabled: true,
      reconnectBaseDelayMs: 1,
      inboundUpdateGraceMs: 1,
      inboundDeafRetryDelayMs: 60_000,
      connectionControlStatePath: statePath,
      alarmNotifier: {
        isConfigured: () => true,
        send: async (input: { kind: string }) => {
          alarms.push(input.kind);
          return { delivered: true };
        },
      },
      fetchImpl: (async (url: string | URL | Request) => {
        calls.push(String(url));
        if (String(url).includes("/chat/findMessages/")) {
          return new Response(JSON.stringify({ messages: { records: [] } }), { status: 200 });
        }
        if (String(url).includes("/instance/connectionState/")) {
          return new Response(JSON.stringify({ instance: { state: "open" } }), { status: 200 });
        }
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    };
    const monitor = new ConnectionHealthMonitor(options);
    monitor.recordInboundMessageUpdate({
      message_id: "msg_missing",
      status: 4,
      known: false,
      process_recovered: async () => false,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(monitor.snapshot()).toMatchObject({
      receiving_degraded: true,
      degraded_reason: "inbound_deaf_suspected",
      inbound_deaf_suspected: true,
      unmatched_inbound_updates_last_24h: 1,
      last_reconciliation_status: "missing",
    });
    expect(alarms).toEqual(["inbound_message_missing"]);
    expect(calls.filter((url) => url.includes("/instance/connect/"))).toHaveLength(0);

    const restartedMonitor = new ConnectionHealthMonitor(options);
    expect(restartedMonitor.snapshot().inbound_deaf_suspected).toBe(true);
    nowMs += 60_001;
    await restartedMonitor.runReachabilityCheck("periodic");
    await new Promise((resolve) => setTimeout(resolve, 10));
    await restartedMonitor.runReachabilityCheck("periodic");
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(calls.filter((url) => url.includes("/instance/connect/"))).toHaveLength(1);
    expect(restartedMonitor.snapshot().reconnect_attempts_last_30m).toBe(1);
    expect(JSON.stringify(logger.events)).not.toContain("msg_missing");
    rmSync(dir, { recursive: true, force: true });
  });
});
