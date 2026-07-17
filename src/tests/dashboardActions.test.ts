import Fastify from "fastify";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { registerDashboardRoutes } from "../bridge/dashboardRoutes.js";
import { PersistentActionAuditStore } from "../store/actionAuditStore.js";
import { PersistentMaintenanceStore } from "../store/maintenanceStore.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EnvConfig } from "../config/env.js";
import type { ReportDataSource } from "../storage/types.js";
import * as backupHelper from "../utils/backupHelper.js";

describe("Dashboard Actions v2", () => {
  let app: ReturnType<typeof Fastify>;
  let auditStore: PersistentActionAuditStore;
  let tempDir: string;
  let env: EnvConfig;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "nowos-dashboard-actions-"));
    auditStore = new PersistentActionAuditStore(join(tempDir, "audit.json"));
    app = Fastify();
    
    env = {
      dashboardOwnerToken: "owner_secret",
      dashboardManagerToken: "manager_secret",
      dashboardAdminToken: "legacy_admin"
    } as EnvConfig;

    const maintenanceStore = new PersistentMaintenanceStore(join(tempDir, "main.json"));
    const queueStore = {
      resolveOpenItemBySafeRef: (safeRef: string) => {
        if (safeRef === "Q-VALID") return { status: "resolved", safe_ref: "Q-VALID" } as any;
        return null;
      }
    } as any;
    const reportDataSource = {
      listCandidateStates: () => [],
      listQueueItems: () => [],
      listPublishers: () => [],
      getQueueSummary: () => ({ total_open: 0, high_priority_count: 0, open_follow_up_count: 0 }),
      listLearningSuggestions: () => []
    } as unknown as ReportDataSource;

    const ingestionStore = {
      resolveSuggestionBySafeRef: (ref: string) => ref === "LRN-VALID" ? { safe_ref: "LRN-VALID", status: "pending_owner_review" } : (ref === "LRN-REVIEWED" ? { safe_ref: "LRN-REVIEWED", status: "approved" } : null),
      reviewSuggestionBySafeRef: () => true,
      listLearningSuggestions: () => []
    } as any;

    registerDashboardRoutes(app, {
      env,
      maintenanceStore,
      queueStore,
      reportDataSource,
      actionAuditStore: auditStore,
      ingestionStore
    });
  });

  afterEach(() => {
    app.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("blocks missing token", async () => {
    const res = await app.inject({ method: "POST", url: "/dashboard/actions/daily-report/generate" });
    expect(res.statusCode).toBe(401);
  });

  it("blocks invalid token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/dashboard/actions/daily-report/generate",
      headers: { "x-dashboard-token": "wrong" }
    });
    expect(res.statusCode).toBe(401);
  });

  it("allows owner to generate daily report", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/dashboard/actions/daily-report/generate",
      headers: { "x-dashboard-token": "owner_secret" }
    });
    expect(res.statusCode).toBe(200);
    const logs = auditStore.getRecentLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].action_type).toBe("daily_report_generate");
    expect(logs[0].actor_role).toBe("owner");
    expect(logs[0].role_resolution_source).toBe("owner_token");
  });

  it("allows manager to generate daily report", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/dashboard/actions/daily-report/generate",
      headers: { "x-dashboard-token": "manager_secret" }
    });
    expect(res.statusCode).toBe(200);
    const logs = auditStore.getRecentLogs();
    expect(logs[0].actor_role).toBe("manager");
    expect(logs[0].role_resolution_source).toBe("manager_token");
  });

  it("blocks manager from owner-only action (maintenance)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/dashboard/actions/maintenance",
      headers: { "x-dashboard-token": "manager_secret" },
      payload: { desired_state: "on", confirm: true }
    });
    expect(res.statusCode).toBe(403);
  });

  it("blocks invalid desired_state", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/dashboard/actions/maintenance",
      headers: { "x-dashboard-token": "owner_secret" },
      payload: { desired_state: "invalid", confirm: true }
    });
    expect(res.statusCode).toBe(400);
  });

  it("allows owner to toggle maintenance ON with confirm and sanitizes reason", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/dashboard/actions/maintenance",
      headers: { "x-dashboard-token": "owner_secret" },
      payload: { desired_state: "on", reason: "Test <script>alert(1)</script>", confirm: true }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().new_state).toBe("on");
    
    const logs = auditStore.getRecentLogs();
    expect(logs[0].action_type).toBe("maintenance_on");
    expect(logs[0].sanitized_reason).toBe("Test alert(1)");
  });

  it("allows owner to toggle maintenance OFF", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/dashboard/actions/maintenance",
      headers: { "x-dashboard-token": "owner_secret" },
      payload: { desired_state: "off", confirm: true }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().new_state).toBe("off");
    
    const logs = auditStore.getRecentLogs();
    expect(logs[0].action_type).toBe("maintenance_off");
  });

  it("blocks high-risk action without confirm (maintenance)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/dashboard/actions/maintenance",
      headers: { "x-dashboard-token": "owner_secret" },
      payload: { desired_state: "on" }
    });
    expect(res.statusCode).toBe(400);
  });

  describe("Backup Trigger", () => {
    beforeEach(() => {
      vi.spyOn(backupHelper, "runBackup").mockImplementation(() => {
        return { success: true, backupSafeRef: "backup_mocked", fileCount: 10 };
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("allows owner to run backup with confirm", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/dashboard/actions/backup/run",
        headers: { "x-dashboard-token": "owner_secret" },
        payload: { confirm: true, reason: "Pre-deploy backup" }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().backup_safe_ref).toBe("backup_mocked");

      const logs = auditStore.getRecentLogs();
      expect(logs[0].action_type).toBe("backup_run");
      expect(logs[0].target_safe_ref).toBe("backup_mocked");
      expect(logs[0].sanitized_reason).toBe("Pre-deploy backup");
      expect(backupHelper.runBackup).toHaveBeenCalled();
    });

    it("blocks manager from running backup", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/dashboard/actions/backup/run",
        headers: { "x-dashboard-token": "manager_secret" },
        payload: { confirm: true }
      });
      expect(res.statusCode).toBe(403);
      expect(backupHelper.runBackup).not.toHaveBeenCalled();
    });

    it("blocks owner without confirm", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/dashboard/actions/backup/run",
        headers: { "x-dashboard-token": "owner_secret" },
        payload: { reason: "Missing confirm" }
      });
      expect(res.statusCode).toBe(400);
      expect(backupHelper.runBackup).not.toHaveBeenCalled();
    });
    
    it("skips duplicate request and doesn't call runBackup", async () => {
      const payload = { confirm: true };
      const headers = { "x-dashboard-token": "owner_secret", "x-idempotency-key": "backup-idem-1" };
      
      const res1 = await app.inject({ method: "POST", url: "/dashboard/actions/backup/run", headers, payload });
      expect(res1.statusCode).toBe(200);
      expect(backupHelper.runBackup).toHaveBeenCalledTimes(1);

      const res2 = await app.inject({ method: "POST", url: "/dashboard/actions/backup/run", headers, payload });
      expect(res2.statusCode).toBe(200);
      expect(res2.json().status).toBe("skipped_duplicate");
      expect(backupHelper.runBackup).toHaveBeenCalledTimes(1); // Still 1
    });
  });

  it("resolves queue item with valid safe_ref", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/dashboard/actions/queue/resolve",
      headers: { "x-dashboard-token": "owner_secret" },
      payload: { confirm: true, queue_ref: "Q-VALID", reason: "Test reason" }
    });
    expect(res.statusCode).toBe(200);

    const logs = auditStore.getRecentLogs();
    expect(logs[0].action_type).toBe("queue_resolve");
    expect(logs[0].target_safe_ref).toBe("Q-VALID");
    expect(logs[0].sanitized_reason).toBe("Test reason");
  });

  it("allows manager to resolve queue item", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/dashboard/actions/queue/resolve",
      headers: { "x-dashboard-token": "manager_secret" },
      payload: { confirm: true, queue_ref: "Q-VALID" }
    });
    expect(res.statusCode).toBe(200);
    const logs = auditStore.getRecentLogs();
    expect(logs[0].actor_role).toBe("manager");
  });

  it("returns 404 for invalid safe_ref", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/dashboard/actions/queue/resolve",
      headers: { "x-dashboard-token": "owner_secret" },
      payload: { confirm: true, queue_ref: "Q-INVALID" }
    });
    expect(res.statusCode).toBe(404);
  });

  it("blocks queue resolve without confirm", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/dashboard/actions/queue/resolve",
      headers: { "x-dashboard-token": "owner_secret" },
      payload: { queue_ref: "Q-VALID" }
    });
    expect(res.statusCode).toBe(400);
  });

  it("handles idempotency correctly", async () => {
    const headers = { "x-dashboard-token": "owner_secret", "x-idempotency-key": "dup123" };
    const res1 = await app.inject({ method: "POST", url: "/dashboard/actions/daily-report/generate", headers });
    expect(res1.statusCode).toBe(200);

    const res2 = await app.inject({ method: "POST", url: "/dashboard/actions/daily-report/generate", headers });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().status).toBe("skipped_duplicate");

    const logs = auditStore.getRecentLogs();
    expect(logs.length).toBe(2);
    expect(logs[0].action_type).toBe("idempotency_duplicate_block");
  });
  
  it("uses test override when SPEC_SYNTHETIC_MODE is true", async () => {
    process.env.SPEC_SYNTHETIC_MODE = "true";
    const res = await app.inject({
      method: "POST",
      url: "/dashboard/actions/daily-report/generate",
      headers: { "x-dashboard-token": "owner_secret", "x-actor-role": "manager" }
    });
    expect(res.statusCode).toBe(200);
    const logs = auditStore.getRecentLogs();
    expect(logs[0].actor_role).toBe("manager");
    expect(logs[0].role_resolution_source).toBe("test_override");
    delete process.env.SPEC_SYNTHETIC_MODE;
  });
});


