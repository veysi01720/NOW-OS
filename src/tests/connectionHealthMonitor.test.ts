import { ConnectionHealthMonitor } from "../observability/connectionHealthMonitor.js";
import { createSilentLogger } from "./testDoubles.js";

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

  it("requests a bounded reconnect once for a closed Evolution state", async () => {
    const logger = createSilentLogger();
    const calls: string[] = [];
    const monitor = new ConnectionHealthMonitor({
      evolutionInstance: "nowakademi_bot",
      evolutionApiBaseUrl: "http://evolution.local",
      evolutionApiKey: "secret-key",
      logger,
      autoReconnectEnabled: true,
      reconnectBaseDelayMs: 1,
      fetchImpl: (async (url) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ instance: { state: "close" } }), { status: 200 });
      }) as typeof fetch,
    });
    await monitor.runReachabilityCheck("periodic");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toContain("http://evolution.local/instance/connect/nowakademi_bot");
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
    const path = `${process.cwd()}/.tmp-evolution-logout-${Date.now()}.json`;
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
  });

  it("starts a cooldown after three reconnect attempts and blocks further attempts", async () => {
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
      reconnectCooldownMs: 30 * 60 * 1000,
      now: () => new Date(nowMs),
      fetchImpl: (async (url) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ instance: { state: "close" } }), { status: 200 });
      }) as typeof fetch,
    });

    for (let i = 0; i < 3; i += 1) {
      monitor.recordEvolutionConnectionUpdate({ state: "close" });
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    monitor.recordEvolutionConnectionUpdate({ state: "close" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    monitor.recordEvolutionConnectionUpdate({ state: "close" });
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(calls).toHaveLength(3);
    expect(monitor.snapshot().reconnect_cooldown_until).toBe("2026-08-12T00:30:00.000Z");
    expect(JSON.stringify(logger.events)).toContain("EVOLUTION_RECONNECT_COOLDOWN_ACTIVE");
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
});
