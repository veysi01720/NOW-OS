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
});
