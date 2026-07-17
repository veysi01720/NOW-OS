import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerDashboardRoutes, DashboardDeps } from "../bridge/dashboardRoutes.js";
import { PersistentMaintenanceStore } from "../store/maintenanceStore.js";
import { PersistentActionAuditStore } from "../store/actionAuditStore.js";
import { PersistentIngestionStore } from "../storage/ingestionStore.js";
import { PersistentNormalizedMessageStore } from "../storage/normalizedMessageStore.js";
import { mkdirSync, rmSync } from "fs";
import { resolve } from "path";
import os from "os";

describe("SPEC-025D: Ingestion to Learning Queue Integration", () => {
  let app: ReturnType<typeof Fastify>;
  let tmpDir: string;
  let deps: DashboardDeps;
  let ingestionStore: PersistentIngestionStore;
  let msgStore: PersistentNormalizedMessageStore;

  beforeEach(() => {
    tmpDir = resolve(os.tmpdir(), `nowos-spec025d-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const maintenanceStore = new PersistentMaintenanceStore(resolve(tmpDir, "maintenance.json"));
    const actionAuditStore = new PersistentActionAuditStore(resolve(tmpDir, "audit.json"));
    ingestionStore = new PersistentIngestionStore(tmpDir);
    msgStore = new PersistentNormalizedMessageStore(resolve(tmpDir, "normalized_messages.json"));
    
    deps = {
      env: { dashboardOwnerToken: "owner_secret", dashboardManagerToken: "manager_secret", dashboardAdminToken: "legacy_secret" } as any,
      reportDataSource: { listQueueItems: () => [], listPublishers: () => [] } as any,
      maintenanceStore,
      actionAuditStore,
      queueStore: {} as any,
      ingestionStore,
      normalizedMessageStore: msgStore
    };

    app = Fastify();
    registerDashboardRoutes(app, deps);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("blocks missing token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/dashboard/actions/ingestion/generate-learning",
      body: { confirm: true }
    });
    expect(res.statusCode).toBe(401);
  });

  it("blocks missing confirm", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/dashboard/actions/ingestion/generate-learning",
      headers: { "x-dashboard-token": "owner_secret", "x-idempotency-key": "testkey123" },
      body: { }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Confirmation required");
  });

  it("blocks missing idempotency key", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/dashboard/actions/ingestion/generate-learning",
      headers: { "x-dashboard-token": "owner_secret" },
      body: { confirm: true }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("idempotency-key required");
  });

  it("generates learning suggestions from valid intents and skips unknown", async () => {
    (msgStore as any).items.push({
      message_ref: "MSG-SUPPORT",
      ingestion_job_ref: "JOB-1",
      platform: "whatsapp",
      message_text_sanitized: "How do I install this?",
      timestamp: new Date().toISOString(),
      detected_intents: ["support_signal"]
    });

    (msgStore as any).items.push({
      message_ref: "MSG-UNKNOWN",
      ingestion_job_ref: "JOB-1",
      platform: "whatsapp",
      message_text_sanitized: "Just saying hi",
      timestamp: new Date().toISOString(),
      detected_intents: ["unknown"]
    });

    const res = await app.inject({
      method: "POST",
      url: "/dashboard/actions/ingestion/generate-learning",
      headers: { "x-dashboard-token": "owner_secret", "x-idempotency-key": "gen1" },
      body: { confirm: true, job_ref: "JOB-1" }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().generated_count).toBe(1);
    expect(res.json().skipped_duplicate_count).toBe(0);

    const suggestions = ingestionStore.listLearningSuggestions();
    expect(suggestions.length).toBe(1);
    expect(suggestions[0].suggestion_class).toBe("support_signal");
    expect(suggestions[0].status).toBe("pending_owner_review");
    expect(suggestions[0].source_message_safe_ref).toBe("MSG-SUPPORT");
    
    // Assert raw data is NOT present
    expect((suggestions[0] as any).raw_payload).toBeUndefined();
  });

  it("skips duplicate suggestions based on dedup key logic", async () => {
    (msgStore as any).items.push({
      message_ref: "MSG-DUP",
      ingestion_job_ref: "JOB-1",
      platform: "whatsapp",
      message_text_sanitized: "A duplicate question",
      timestamp: new Date().toISOString(),
      detected_intents: ["training_question"]
    });

    // Run first time
    await app.inject({
      method: "POST",
      url: "/dashboard/actions/ingestion/generate-learning",
      headers: { "x-dashboard-token": "owner_secret", "x-idempotency-key": "gen-dup-1" },
      body: { confirm: true, job_ref: "JOB-1" }
    });

    expect(ingestionStore.listLearningSuggestions().length).toBe(1);

    // Run second time with different idempotency key (simulating second request)
    const res2 = await app.inject({
      method: "POST",
      url: "/dashboard/actions/ingestion/generate-learning",
      headers: { "x-dashboard-token": "owner_secret", "x-idempotency-key": "gen-dup-2" },
      body: { confirm: true, job_ref: "JOB-1" }
    });

    expect(res2.statusCode).toBe(200);
    expect(res2.json().generated_count).toBe(0);
    expect(res2.json().skipped_duplicate_count).toBe(1);
    expect(ingestionStore.listLearningSuggestions().length).toBe(1);
  });

  it("handles duplicate idempotency keys safely", async () => {
    const run = () => app.inject({
      method: "POST",
      url: "/dashboard/actions/ingestion/generate-learning",
      headers: { "x-dashboard-token": "manager_secret", "x-idempotency-key": "same-key-123" },
      body: { confirm: true }
    });

    const res1 = await run();
    expect(res1.statusCode).toBe(200);

    const res2 = await run();
    expect(res2.statusCode).toBe(200);
    expect(res2.json().status).toBe("skipped_duplicate");
  });
});
