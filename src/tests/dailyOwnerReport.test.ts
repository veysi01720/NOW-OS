import { test, expect } from "vitest";
import { detectDailyReportIntent, buildDailyOwnerReport } from "../bridge/dailyOwnerReport.js";
import type { EnvConfig } from "../config/env.js";

function getEmptyEnv(): EnvConfig {
  return {
    port: 3000,
    evolutionApiBaseUrl: "http://localhost:8080",
    evolutionApiKey: "test",
    evolutionInstance: "test",
    openaiApiKey: "test",
    openaiAssistantId: "test",
    ownerPhoneNumbers: ["905551112233"],
    managerPhoneNumbers: ["905554445566"],
    approvedApps: ["AppA"],
    dashboardAdminToken: "test",
    dashboardOwnerToken: "test_owner",
    dashboardManagerToken: "test_manager",
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
    modelAdapterCanaryIntents: [],
    modelAdapterCanaryPercent: 0,
    modelExecutionTimeoutEnabled: false,
    modelExecutionTimeoutMs: 45_000,
    responsesShadowEnabled: false,
    responsesShadowMode: "off",
    responsesShadowTenants: [],
    responsesShadowRoles: [],
    responsesShadowTimeoutMs: 15_000,
    conversationDecisionV2Enabled: false,
    versions: {
      assistant_response_contract_version: "1.0",
      system_prompt_version: "1.0",
      knowledge_base_version: "1.0",
      backend_context_version: "1.0",
      state_machine_version: "1.0"
    }
  };
}

class MockDailyReportStore {
  private memory = new Set<string>();

  markDailyReportGenerated(state: any): void {
    this.memory.add(`${state.report_date}_${state.delivery_mode}_${state.sent_to_role}`);
  }

  checkDailyReportDuplicate(reportDate: string, deliveryMode: string, sentToRole: string): boolean {
    return this.memory.has(`${reportDate}_${deliveryMode}_${sentToRole}`);
  }
}

class MockReportDataSource {
  listCandidateStates() { return []; }
  listQueueItems() { return []; }
  getQueueSummary() {
    return {
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
    };
  }
  listPublishers() { return []; }
  listLearningSuggestions() { return []; }
  listKnowledgePatches() { return []; }
  listPublishJobs() { return []; }
}

test("detectDailyReportIntent parses correctly", () => {
  expect(detectDailyReportIntent("Gunluk rapor ver")).toBe(true);
  expect(detectDailyReportIntent("bugün ne oldu")).toBe(true);
  expect(detectDailyReportIntent("nasılsın")).toBe(false);
});

test("buildDailyOwnerReport handles first_generated correctly", () => {
  const ds = new MockReportDataSource();
  const dsStore = new MockDailyReportStore();
  const env = getEmptyEnv();
  
  const report = buildDailyOwnerReport(ds as any, dsStore as any, env, false, "owner", "manual");
  
  expect(report.duplicate_status).toBe("first_generated");
  expect(report.candidate_summary.total_candidates).toBe(0);
});

test("buildDailyOwnerReport handles duplicate correctly", () => {
  const ds = new MockReportDataSource();
  const dsStore = new MockDailyReportStore();
  const env = getEmptyEnv();
  
  buildDailyOwnerReport(ds as any, dsStore as any, env, false, "owner", "manual");
  const report2 = buildDailyOwnerReport(ds as any, dsStore as any, env, false, "owner", "manual");
  
  expect(report2.duplicate_status).toBe("manual_regenerated_same_day");
});
