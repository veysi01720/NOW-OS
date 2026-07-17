import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export interface DashboardActionAuditV1 {
  action_id_safe: string;
  action_type: string;
  actor_role: "owner" | "manager" | "unknown";
  actor_masked_ref: string;
  role_resolution_source: "owner_token" | "manager_token" | "legacy_admin_owner" | "test_override" | "unknown";
  target_type: "system" | "queue" | "publisher" | "learning" | "daily_report";
  target_safe_ref: string;
  risk_level: "LOW" | "MEDIUM" | "HIGH";
  confirm_required: boolean;
  confirmed: boolean;
  idempotency_key_hash?: string;
  result_status: "success" | "failure" | "pending" | "skipped_duplicate";
  created_at: string;
  sanitized_reason?: string;
  error_safe_message?: string;
  previous_status?: string;
  imported_count?: number;
  generated_count?: number;
  new_status?: string;
  skipped_duplicate_count?: number;
  duplicate_count?: number;
  converted_count?: number;
  rejected_count?: number;
  sanitized_error?: string;
  platform?: string;
  source_type?: string;
  job_ref?: string;
  source_label_safe?: string;
  import_batch_ref?: string;
}

export interface ActionAuditStore {
  logAction(audit: Omit<DashboardActionAuditV1, "action_id_safe" | "created_at">): void;
  getRecentLogs(limit?: number): DashboardActionAuditV1[];
  hasIdempotencyKey(hash: string): boolean;
}

export class PersistentActionAuditStore implements ActionAuditStore {
  private filePath: string;
  private logs: DashboardActionAuditV1[] = [];
  private idempotencyKeys = new Set<string>();
  private maxLogs = 5000;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  private load() {
    try {
      const data = readFileSync(this.filePath, "utf-8");
      this.logs = JSON.parse(data);
      if (!Array.isArray(this.logs)) {
        this.logs = [];
      }
      this.logs.forEach(l => {
        if (l.idempotency_key_hash) this.idempotencyKeys.add(l.idempotency_key_hash);
      });
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        console.error("Failed to load audit logs:", err.message);
      }
      this.logs = [];
    }
  }

  private save() {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.logs, null, 2), "utf-8");
    } catch (err) {
      console.error("Failed to save audit logs:", err);
    }
  }

  logAction(audit: Omit<DashboardActionAuditV1, "action_id_safe" | "created_at">): void {
    const fullAudit: DashboardActionAuditV1 = {
      ...audit,
      action_id_safe: randomUUID(),
      created_at: new Date().toISOString()
    };
    
    this.logs.unshift(fullAudit);
    if (fullAudit.idempotency_key_hash) {
      this.idempotencyKeys.add(fullAudit.idempotency_key_hash);
    }

    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
      // Rebuild idempotency keys set to prevent memory leak
      this.idempotencyKeys.clear();
      this.logs.forEach(l => {
        if (l.idempotency_key_hash) this.idempotencyKeys.add(l.idempotency_key_hash);
      });
    }

    this.save();
  }

  getRecentLogs(limit: number = 100): DashboardActionAuditV1[] {
    return this.logs.slice(0, limit);
  }

  hasIdempotencyKey(hash: string): boolean {
    return this.idempotencyKeys.has(hash);
  }
}
