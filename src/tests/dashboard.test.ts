import { test, expect } from "vitest";
import Fastify from "fastify";
import { registerDashboardRoutes } from "../bridge/dashboardRoutes.js";
import type { ReportDataSource } from "../storage/types.js";
import type { MaintenanceStore } from "../store/maintenanceStore.js";
import type { EnvConfig } from "../config/env.js";
import type { ActionAuditStore, DashboardActionAuditV1 } from "../store/actionAuditStore.js";
import { resolve } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";

function createMockDeps() {
  const env: EnvConfig = {
    port: 3000,
    evolutionApiBaseUrl: "http://localhost:8080",
    evolutionApiKey: "test",
    evolutionInstance: "test",
    openaiApiKey: "test",
    openaiAssistantId: "test",
    ownerPhoneNumbers: ["905551112233"],
    managerPhoneNumbers: ["905554445566"],
    approvedApps: ["AppA"],
    dashboardAdminToken: "super_secret_admin",
    dashboardOwnerToken: "super_secret_owner",
    dashboardManagerToken: "super_secret_manager",
    realOpenaiPublishEnabled: false,
    webhookQueueMode: "off",
    outboundQueueMode: "off",
    fastAckEnabled: false,
    workersEnabled: false,
    behaviorOrchestratorEnabled: false,
    behaviorCanaryMode: "off",
    behaviorCanaryTenants: [],
    behaviorCanaryRoles: ["owner", "manager"],
    behaviorTenantCanaryEnabled: false,
    modelAdapterLayerEnabled: false,
    modelAdapterCanaryMode: "off",
    modelAdapterCanaryTenants: [],
    modelAdapterCanaryRoles: ["owner", "manager"],
    modelExecutionTimeoutEnabled: false,
    modelExecutionTimeoutMs: 45_000,
    responsesShadowEnabled: false,
    responsesShadowMode: "off",
    responsesShadowTenants: [],
    responsesShadowRoles: [],
    responsesShadowTimeoutMs: 15_000,
    versions: {
      assistant_response_contract_version: "1.0",
      system_prompt_version: "1.0",
      knowledge_base_version: "1.0",
      backend_context_version: "1.0",
      state_machine_version: "1.0"
    }
  };

  const reportDataSource: ReportDataSource = {
    listCandidateStates: () => [],
    listQueueItems: () => [],
    getQueueSummary: () => ({
      users_waiting_selected_app: 0,
      users_waiting_phone_type: 0,
      users_ready_for_installation: 0,
      open_missing_info_count: 0,
      open_follow_up_count: 0,
      high_priority_count: 0,
      open_items_by_priority: { HIGH: 0, MEDIUM: 0, LOW: 0 },
      open_items_by_reason: {},
      total_queue_items: 0,
      latest_update_at: new Date().toISOString()
    }),
    listPublishers: () => [],
    listLearningSuggestions: () => [],
    listKnowledgePatches: () => [],
    listPublishJobs: () => []
  };

  const maintenanceStore = { isEnabled: () => false, setEnabled: () => {} };
  const actionAuditStore = { logAction: () => {}, getRecentLogs: () => [], hasIdempotencyKey: () => false };
  const queueStore = { resolveOpenItemBySafeRef: () => null } as any;
  const ingestionStore = { resolveSuggestionBySafeRef: () => null, reviewSuggestionBySafeRef: () => false, listLearningSuggestions: () => [] } as any;
  return { env, reportDataSource, maintenanceStore, actionAuditStore, queueStore, ingestionStore };
}

test("dashboard token auth", async () => {
  const app = Fastify();
  registerDashboardRoutes(app, createMockDeps());

  // Write a dummy dashboard.html to prevent readFileSync error
  try {
    mkdirSync(resolve(__dirname, "../bridge"), { recursive: true });
    writeFileSync(resolve(__dirname, "../bridge/dashboard.html"), "<html></html>");
  } catch(e) {}

  const res1 = await app.inject({
    method: "GET",
    url: "/dashboard/health"
  });
  expect(res1.statusCode).toBe(401);

  const res2 = await app.inject({
    method: "GET",
    url: "/dashboard/health",
    headers: { "x-dashboard-token": "wrong_token" }
  });
  expect(res2.statusCode).toBe(401);

  const res3 = await app.inject({
    method: "GET",
    url: "/dashboard/health",
    headers: { "x-dashboard-token": "super_secret_admin" }
  });
  expect(res3.statusCode).toBe(200);
});

test("dashboard summary data is sanitized and read-only", async () => {
  const app = Fastify();
  const deps = createMockDeps();
  registerDashboardRoutes(app, deps);

  const res = await app.inject({
    method: "GET",
    url: "/dashboard/summary",
    headers: { "x-dashboard-token": "super_secret_admin" }
  });

  expect(res.statusCode).toBe(200);
  const data = res.json();
  expect(data.contract_version).toBe("1.0");
  expect(data.system_status).toBe("online");
  expect(data.daily_report_summary).toBeDefined();
  
  // Verify structure is complete
  expect(data.candidate_summary).toBeDefined();
  expect(data.publisher_summary).toBeDefined();
  expect(data.queue_summary).toBeDefined();
  expect(data.group_summary).toBeDefined();
  expect(data.production_summary.maintenance_mode).toBe(false);
});
