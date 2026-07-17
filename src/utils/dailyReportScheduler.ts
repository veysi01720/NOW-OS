import { buildDailyOwnerReport } from "../bridge/dailyOwnerReport.js";
import { PersistentScheduledReportConfigStore, PersistentScheduledReportRunStore, ReportRun } from "../store/scheduledReportStore.js";
import { isConfiguredTimeDue, getDateBucket } from "./timezoneScheduler.js";
import { logger } from "./logger.js";
import type { ReportDataSource, DailyReportStore } from "../storage/types.js";
import type { EnvConfig } from "../config/env.js";
import { PersistentMaintenanceStore } from "../store/maintenanceStore.js";

export class DailyReportSchedulerService {
  constructor(
    private configStore: PersistentScheduledReportConfigStore,
    private runStore: PersistentScheduledReportRunStore,
    private maintenanceStore: PersistentMaintenanceStore,
    private dataSource: ReportDataSource,
    private dailyReportStore: DailyReportStore,
    private env: EnvConfig,
    private sendWhatsAppCallback?: (targetRole: "owner" | "manager", text: string) => Promise<boolean>
  ) {}

  public async tick(now: Date = new Date()): Promise<ReportRun[]> {
    const config = this.configStore.getConfig();
    if (!config.enabled) {
      return [];
    }

    if (!isConfiguredTimeDue(now, config)) {
      return [];
    }

    const dateBucket = getDateBucket(now, config.timezone);
    const targetMode = config.delivery_mode;
    
    if (this.runStore.hasRunInBucket(config.schedule_ref, config.timezone, dateBucket, targetMode)) {
      return []; // Already ran for this bucket
    }

    return [await this.executeRun("scheduled", "system", now)];
  }

  public async executeRun(
    triggerType: "scheduled" | "manual_preview" | "manual_send",
    actorRole: "owner" | "manager" | "system",
    now: Date = new Date(),
    idempotencyKey?: string
  ): Promise<ReportRun> {
    const config = this.configStore.getConfig();
    const isMaintenance = this.maintenanceStore.isEnabled();

    let targetMode = config.delivery_mode;
    if (triggerType === "manual_preview") {
      targetMode = "preview_only";
    }

    const dateBucket = getDateBucket(now, config.timezone);

    // Safety Gates for Send
    const isDryRun = config.dry_run;
    const isWhatsAppEnabled = config.send_whatsapp;
    const isDeliveryModeWhatsApp = targetMode.startsWith("whatsapp_");
    
    // Evaluate if we should actually send
    let shouldSend = false;
    let blockedReason: string | null = null;
    
    if (triggerType === "manual_preview") {
      shouldSend = false;
    } else if (triggerType === "manual_send" || triggerType === "scheduled") {
      if (!isWhatsAppEnabled) {
        shouldSend = false;
        blockedReason = "send_whatsapp_false";
      } else if (isDryRun) {
        shouldSend = false;
        blockedReason = "dry_run_true";
      } else if (!isDeliveryModeWhatsApp) {
        shouldSend = false;
        blockedReason = "delivery_mode_not_whatsapp";
      } else if (isMaintenance) {
        shouldSend = false;
        blockedReason = "maintenance_mode_active";
      } else if (actorRole === "manager" && triggerType === "manual_send") {
        shouldSend = false;
        blockedReason = "manager_run_send_blocked";
      } else {
        shouldSend = true;
      }
    }

    const reportObj = buildDailyOwnerReport(
      this.dataSource,
      this.dailyReportStore,
      this.env,
      isMaintenance,
      "owner",
      triggerType === "scheduled" ? "scheduled" : "manual",
      now.toISOString()
    );

    // Clean any boss note just in case
    const safeReportObj = JSON.parse(JSON.stringify(reportObj).replace(/"internal_boss_note"/g, '"redacted"'));
    
    // Format a simple text preview
    const reportText = `[Daily Owner Report] - ${dateBucket}\nCandidates: ${safeReportObj.candidate_summary?.total_candidates || 0} (${safeReportObj.candidate_summary?.new_leads_count || 0} new)\nQueue Open: ${safeReportObj.queue_summary?.open_follow_up_count || 0} follow-ups, ${safeReportObj.queue_summary?.open_missing_info_count || 0} missing info\nMaintenance: ${safeReportObj.system_status?.maintenance_active ? "ON" : "OFF"}\n`;

    let finalStatus: "preview_created" | "sent" | "failed" | "blocked" = "preview_created";
    if (blockedReason && triggerType !== "manual_preview") {
      finalStatus = "blocked";
    }

    if (shouldSend) {
      finalStatus = "sent";
      try {
        if (this.sendWhatsAppCallback) {
          if (targetMode === "whatsapp_owner" || targetMode === "whatsapp_owner_and_manager") {
            await this.sendWhatsAppCallback("owner", reportText);
          }
          if (targetMode === "whatsapp_manager" || targetMode === "whatsapp_owner_and_manager") {
            await this.sendWhatsAppCallback("manager", reportText);
          }
        } else {
          logger.warn("sendWhatsAppCallback not provided, mock sending...");
        }
      } catch (err: any) {
        finalStatus = "failed";
        blockedReason = `Send failed: ${err.message || "unknown"}`;
      }
    }

    const run = this.runStore.createRun({
      schedule_ref: config.schedule_ref,
      trigger_type: triggerType,
      status: finalStatus,
      target_mode: targetMode,
      report_preview_sanitized: reportText,
      error_sanitized: blockedReason,
      actor_role: actorRole,
      timezone: config.timezone,
      scheduled_time: dateBucket,
      idempotency_hash: idempotencyKey,
      safety_gate_result: {
        is_maintenance: isMaintenance,
        is_dry_run: isDryRun,
        is_whatsapp_enabled: isWhatsAppEnabled,
        is_delivery_whatsapp: isDeliveryModeWhatsApp,
        should_send: shouldSend,
      }
    });

    return run;
  }
}
