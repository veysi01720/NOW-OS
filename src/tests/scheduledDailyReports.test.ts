import { readFileSync, rmSync, mkdirSync } from "fs";
import { resolve } from "path";
import { test, expect, beforeAll, afterAll } from "vitest";
import { PersistentScheduledReportConfigStore, PersistentScheduledReportRunStore } from "../store/scheduledReportStore.js";
import { PersistentMaintenanceStore } from "../store/maintenanceStore.js";
import { DailyReportSchedulerService } from "../utils/dailyReportScheduler.js";
import { getZonedDateParts, getDateBucket, isConfiguredTimeDue, computeNextRunAt } from "../utils/timezoneScheduler.js";
import type { ReportDataSource } from "../storage/types.js";

const TEST_DIR = resolve("data", "test_spec026");

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

test("timezoneScheduler - getZonedDateParts", () => {
  const dt = new Date("2026-07-06T12:00:00Z");
  const parts = getZonedDateParts(dt, "Europe/Istanbul");
  expect(parts.hour).toBe(15);
  expect(parts.minute).toBe(0);
});

test("timezoneScheduler - invalid timezone fallback", () => {
  const dt = new Date("2026-07-06T12:00:00Z");
  const parts = getZonedDateParts(dt, "Invalid/Timezone");
  // Falls back to Europe/Istanbul
  expect(parts.hour).toBe(15);
});

test("scheduledReportStore - default config and update", () => {
  const configStore = new PersistentScheduledReportConfigStore(resolve(TEST_DIR, "config.json"));
  const config = configStore.getConfig();
  expect(config.enabled).toBe(false);
  expect(config.dry_run).toBe(true);
  
  configStore.updateConfig("default", { enabled: true, timezone: "Invalid/Timezone" });
  const updated = configStore.getConfig();
  expect(updated.enabled).toBe(true);
  expect(updated.timezone).toBe("Europe/Istanbul"); // Fallback
});

test("scheduler - dry_run and send_whatsapp false block sending", async () => {
  const configStore = new PersistentScheduledReportConfigStore(resolve(TEST_DIR, "config2.json"));
  configStore.updateConfig("default", { enabled: true, delivery_mode: "whatsapp_owner", send_whatsapp: true, dry_run: true });
  
  const runStore = new PersistentScheduledReportRunStore(resolve(TEST_DIR, "runs2.json"));
  const maintenanceStore = new PersistentMaintenanceStore(resolve(TEST_DIR, "maint2.json"));
  
  const ds: any = {
    listCandidateStates: () => [],
    listQueueItems: () => [],
    getQueueSummary: () => ({}),
    listPublishers: () => [],
  };
  const dsStore: any = {
    checkDailyReportDuplicate: () => false,
    markDailyReportGenerated: () => {}
  }
  const env: any = {};
  
  const service = new DailyReportSchedulerService(configStore, runStore, maintenanceStore, ds, dsStore, env);
  const run = await service.executeRun("scheduled", "system", new Date());
  
  expect(run.status).toBe("blocked");
  expect(run.error_sanitized).toBe("dry_run_true");
});

test("scheduler - duplicate idempotency", () => {
  const runStore = new PersistentScheduledReportRunStore(resolve(TEST_DIR, "runs_dup.json"));
  runStore.createRun({
    schedule_ref: "default",
    trigger_type: "scheduled",
    status: "sent",
    target_mode: "whatsapp_owner",
    report_preview_sanitized: "test",
    timezone: "UTC",
    scheduled_time: "2026-07-06",
  });
  
  const hasRun = runStore.hasRunInBucket("default", "UTC", "2026-07-06", "whatsapp_owner");
  expect(hasRun).toBe(true);
});
