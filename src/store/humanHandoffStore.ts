import { createHash, randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";

export type HumanHandoffStatus = "pending" | "acknowledged" | "resolved" | "suppressed";

export interface HumanHandoffRecord {
  handoff_id: string;
  tenant_id: string;
  reason_code: string;
  urgency: "low" | "medium" | "high";
  conversation_key_hash: string;
  source_correlation_id: string;
  status: HumanHandoffStatus;
  notification_enabled: boolean;
  notification_status: "disabled" | "pending" | "sent" | "failed";
  owner_query?: {
    candidate_phone: string;
    question_sanitized: string;
    failure_reason: string;
    team_escalated: boolean;
  };
  created_at: string;
  updated_at: string;
  audit: Array<{ event: "created" | "status_changed"; actor: string; at: string; from?: string; to?: string }>;
}

type CreateInput = {
  tenant_id: string;
  reason_code: string;
  urgency?: "low" | "medium" | "high";
  conversation_key_hash: string;
  source_correlation_id: string;
};

export interface HumanHandoffStore {
  create(input: CreateInput): { created: boolean; record: HumanHandoffRecord };
  createOwnerQuery(input: Omit<CreateInput, "reason_code"> & { candidate_phone: string; question_sanitized: string; failure_reason: string }): { created: boolean; record: HumanHandoffRecord };
  findPendingOwnerQuery(): HumanHandoffRecord | null;
  resolveOwnerQuery(handoffId: string): boolean;
  markOwnerNotification(handoffId: string, status: "sent" | "failed"): boolean;
  markOwnerQueryTeamEscalated(handoffId: string): boolean;
  list(limit?: number): HumanHandoffRecord[];
  stats(): { pending_count: number; total_count: number; oldest_pending_at: string | null };
}

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

export class PersistentHumanHandoffStore implements HumanHandoffStore {
  private records: HumanHandoffRecord[] = [];

  constructor(private readonly path: string) {
    this.load();
  }

  private load(): void {
    try {
      const value = JSON.parse(readFileSync(this.path, "utf8")) as unknown;
      this.records = Array.isArray(value) ? value as HumanHandoffRecord[] : [];
    } catch {
      this.records = [];
    }
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(this.records, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(temporaryPath, this.path);
  }

  create(input: CreateInput): { created: boolean; record: HumanHandoffRecord } {
    const key = hash([input.tenant_id, input.conversation_key_hash, input.reason_code].join("|"));
    const old = this.records.find((item) => item.conversation_key_hash === key && item.status !== "resolved");
    if (old) return { created: false, record: old };
    const now = new Date().toISOString();
    const record: HumanHandoffRecord = {
      handoff_id: randomUUID(),
      tenant_id: input.tenant_id,
      reason_code: input.reason_code,
      urgency: input.urgency ?? "medium",
      conversation_key_hash: key,
      source_correlation_id: input.source_correlation_id,
      status: "pending",
      notification_enabled: input.reason_code === "conversational_escalation_claim",
      notification_status: input.reason_code === "conversational_escalation_claim" ? "pending" : "disabled",
      created_at: now,
      updated_at: now,
      audit: [{ event: "created", actor: "system", at: now }],
    };
    this.records.unshift(record);
    this.records = this.records.slice(0, 5000);
    this.save();
    return { created: true, record };
  }

  createOwnerQuery(input: Omit<CreateInput, "reason_code"> & { candidate_phone: string; question_sanitized: string; failure_reason: string }): { created: boolean; record: HumanHandoffRecord } {
    const result = this.create({ ...input, reason_code: "owner_answer_required" });
    if (!result.created) return result;
    result.record.notification_enabled = true;
    result.record.notification_status = "pending";
    result.record.owner_query = {
      candidate_phone: input.candidate_phone,
      question_sanitized: input.question_sanitized,
      failure_reason: input.failure_reason,
      team_escalated: false,
    };
    this.save();
    return result;
  }

  findPendingOwnerQuery(): HumanHandoffRecord | null {
    return this.records.find((item) => item.status === "pending" && item.reason_code === "owner_answer_required" && item.owner_query?.team_escalated !== true) ?? null;
  }

  resolveOwnerQuery(handoffId: string): boolean {
    const record = this.records.find((item) => item.handoff_id === handoffId && item.status === "pending");
    if (!record) return false;
    const now = new Date().toISOString();
    record.status = "resolved";
    record.updated_at = now;
    record.audit.push({ event: "status_changed", actor: "owner", at: now, from: "pending", to: "resolved" });
    this.save();
    return true;
  }

  markOwnerNotification(handoffId: string, status: "sent" | "failed"): boolean {
    const record = this.records.find((item) => item.handoff_id === handoffId);
    if (!record) return false;
    record.notification_status = status;
    record.updated_at = new Date().toISOString();
    this.save();
    return true;
  }

  markOwnerQueryTeamEscalated(handoffId: string): boolean {
    const record = this.records.find((item) => item.handoff_id === handoffId && item.status === "pending");
    if (!record?.owner_query) return false;
    record.owner_query.team_escalated = true;
    record.updated_at = new Date().toISOString();
    this.save();
    return true;
  }

  list(limit = 100): HumanHandoffRecord[] {
    return this.records.slice(0, Math.max(1, Math.min(limit, 500)));
  }

  stats(): { pending_count: number; total_count: number; oldest_pending_at: string | null } {
    const pending = this.records.filter((item) => item.status === "pending");
    return {
      pending_count: pending.length,
      total_count: this.records.length,
      oldest_pending_at: pending.length ? pending[pending.length - 1].created_at : null,
    };
  }
}
