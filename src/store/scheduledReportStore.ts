import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_TIMEZONE, getSafeTimezone } from "../utils/timezoneScheduler.js";

export abstract class PersistentJsonStore {
  constructor(protected readonly filePath: string) {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
    } catch {}
  }
  protected readData(): any {
    try {
      return JSON.parse(readFileSync(this.filePath, "utf-8"));
    } catch {
      return {};
    }
  }
  protected writeData(data: any): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch {}
  }
}


export interface ScheduledReportConfig {
  schedule_ref: string;
  timezone: string;
  configured_hour: number;
  configured_minute: number;
  enabled: boolean;
  dry_run: boolean;
  target_role: "owner" | "manager" | "both";
  send_whatsapp: boolean;
  delivery_mode: "preview_only" | "dashboard_only" | "whatsapp_owner" | "whatsapp_manager" | "whatsapp_owner_and_manager";
  max_retry_count: number;
  last_run_at?: string | null;
  next_run_at?: string | null;
  last_status?: "skipped" | "preview_created" | "sent" | "failed" | "blocked" | "not_started";
  last_error_sanitized?: string | null;
}

export interface ReportRun {
  run_ref: string;
  schedule_ref: string;
  trigger_type: "scheduled" | "manual_preview" | "manual_send";
  status: "skipped" | "preview_created" | "sent" | "failed" | "blocked";
  target_mode: string;
  generated_at: string;
  sent_at?: string;
  report_preview_sanitized: string;
  error_sanitized?: string | null;
  idempotency_hash?: string;
  actor_role?: "owner" | "manager" | "system";
  timezone: string;
  scheduled_time: string;
  safety_gate_result?: Record<string, boolean>;
}

export class PersistentScheduledReportConfigStore extends PersistentJsonStore {
  public getConfig(scheduleRef: string = "default"): ScheduledReportConfig {
    const data = this.readData();
    const config = data.scheduled_report_configs?.[scheduleRef];
    if (config) {
      return config;
    }
    
    // Default config
    return {
      schedule_ref: scheduleRef,
      timezone: DEFAULT_TIMEZONE,
      configured_hour: 9,
      configured_minute: 0,
      enabled: false,
      dry_run: true,
      target_role: "owner",
      send_whatsapp: false,
      delivery_mode: "preview_only",
      max_retry_count: 1,
      last_run_at: null,
      next_run_at: null,
      last_status: "not_started",
      last_error_sanitized: null,
    };
  }

  public updateConfig(scheduleRef: string, updates: Partial<ScheduledReportConfig>): ScheduledReportConfig {
    const data = this.readData();
    if (!data.scheduled_report_configs) {
      data.scheduled_report_configs = {};
    }
    const current = this.getConfig(scheduleRef);
    const updated = { ...current, ...updates };
    
    // Validate timezone
    updated.timezone = getSafeTimezone(updated.timezone);
    
    data.scheduled_report_configs[scheduleRef] = updated;
    this.writeData(data);
    return updated;
  }
}

export class PersistentScheduledReportRunStore extends PersistentJsonStore {
  public createRun(run: Omit<ReportRun, "run_ref" | "generated_at">): ReportRun {
    const data = this.readData();
    if (!data.scheduled_report_runs) {
      data.scheduled_report_runs = [];
    }
    const newRun: ReportRun = {
      ...run,
      run_ref: `RUN-${randomUUID().slice(0, 8).toUpperCase()}`,
      generated_at: new Date().toISOString(),
    };
    data.scheduled_report_runs.push(newRun);
    this.writeData(data);
    return newRun;
  }

  public getRuns(limit: number = 50): ReportRun[] {
    const data = this.readData();
    const runs = data.scheduled_report_runs || [];
    return runs.slice(-limit).reverse();
  }

  public hasRunInBucket(scheduleRef: string, timezone: string, dateBucket: string, targetMode: string): boolean {
    const data = this.readData();
    const runs: ReportRun[] = data.scheduled_report_runs || [];
    return runs.some((r: ReportRun) => 
      r.schedule_ref === scheduleRef &&
      r.timezone === timezone &&
      r.scheduled_time === dateBucket &&
      r.target_mode === targetMode &&
      (r.status === "sent" || r.status === "preview_created") &&
      r.trigger_type === "scheduled"
    );
  }

  public hasIdempotencyHash(hash: string): boolean {
    const data = this.readData();
    const runs: ReportRun[] = data.scheduled_report_runs || [];
    return runs.some((r: ReportRun) => r.idempotency_hash === hash);
  }
}
