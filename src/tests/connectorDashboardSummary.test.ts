import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerDashboardRoutes, DashboardDeps } from "../bridge/dashboardRoutes.js";
import { PersistentMaintenanceStore } from "../store/maintenanceStore.js";
import { PersistentActionAuditStore } from "../store/actionAuditStore.js";
import { PersistentIngestionJobStore } from "../storage/ingestionJobStore.js";
import { PersistentNormalizedMessageStore } from "../storage/normalizedMessageStore.js";
import { mkdirSync, rmSync } from "fs";
import { resolve } from "path";
import os from "os";

describe("SPEC-025C: Dashboard Connector / Ingestion Summary", () => {
  let app: ReturnType<typeof Fastify>;
  let tmpDir: string;
  let deps: DashboardDeps;
  let jobStore: PersistentIngestionJobStore;
  let msgStore: PersistentNormalizedMessageStore;

  beforeEach(() => {
    tmpDir = resolve(os.tmpdir(), `nowos-spec025c-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const maintenanceStore = new PersistentMaintenanceStore(resolve(tmpDir, "maintenance.json"));
    const actionAuditStore = new PersistentActionAuditStore(resolve(tmpDir, "audit.json"));
    jobStore = new PersistentIngestionJobStore(resolve(tmpDir, "ingestion_jobs.json"));
    msgStore = new PersistentNormalizedMessageStore(resolve(tmpDir, "normalized_messages.json"));
    
    deps = {
      env: { dashboardOwnerToken: "owner_secret", dashboardManagerToken: "manager_secret", dashboardAdminToken: "legacy_secret" } as any,
      reportDataSource: { listQueueItems: () => [], listPublishers: () => [] } as any,
      maintenanceStore,
      actionAuditStore,
      queueStore: {} as any,
      ingestionJobStore: jobStore,
      normalizedMessageStore: msgStore
    };

    app = Fastify();
    registerDashboardRoutes(app, deps);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("allows owner to fetch summary", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/dashboard/connectors/summary",
      headers: { "x-dashboard-token": "owner_secret" }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total_ingestion_jobs).toBe(0);
  });

  it("blocks missing token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/dashboard/connectors/summary"
    });
    expect(res.statusCode).toBe(401);
  });

  it("strips unexpected raw fields from messages response", async () => {
    // Setup a job
    const job = jobStore.createJob("whatsapp", "manual_import", "owner");
    
    // Setup a message with unexpected raw payload
    (msgStore as any).items.push({
      message_ref: "MSG-123",
      dedup_key: "hash123",
      ingestion_job_ref: job.job_ref,
      platform: "whatsapp",
      source_type: "manual_import",
      message_text_sanitized: "Hello world",
      timestamp: new Date().toISOString(),
      direction: "inbound",
      // the dangerous fields:
      raw_payload: { secrets: "leak-me" },
      raw_platform_id: "5551234",
      internal_boss_note: "do not show this"
    });

    const res = await app.inject({
      method: "GET",
      url: `/dashboard/connectors/messages?job_ref=${job.job_ref}`,
      headers: { "x-dashboard-token": "owner_secret" }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.messages.length).toBe(1);
    
    const m = body.messages[0];
    expect(m.message_ref).toBe("MSG-123");
    expect(m.message_text_sanitized).toBe("Hello world");
    
    // Assert stripped
    expect(m.raw_payload).toBeUndefined();
    expect(m.raw_platform_id).toBeUndefined();
    expect(m.internal_boss_note).toBeUndefined();
  });

  it("caps long message text", async () => {
    const job = jobStore.createJob("whatsapp", "manual_import", "owner");
    
    (msgStore as any).items.push({
      message_ref: "MSG-LONG",
      dedup_key: "hashLONG",
      ingestion_job_ref: job.job_ref,
      platform: "whatsapp",
      source_type: "manual_import",
      message_text_sanitized: "A".repeat(2000),
      timestamp: new Date().toISOString(),
      direction: "inbound"
    });

    const res = await app.inject({
      method: "GET",
      url: `/dashboard/connectors/messages?job_ref=${job.job_ref}`,
      headers: { "x-dashboard-token": "manager_secret" }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const m = body.messages[0];
    expect(m.message_text_sanitized.length).toBeLessThan(1020);
    expect(m.message_text_sanitized.endsWith("[truncated]")).toBe(true);
  });
});
