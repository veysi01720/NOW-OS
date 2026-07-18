import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface ModelAdapterCanaryApproval {
  schema_version: 1;
  approval_id: string;
  approval_generation: string;
  approved: boolean;
  issued_by: "owner_dashboard_token";
  issued_at: string;
  expires_at: string;
  maximum_observed_messages: number;
  scope: {
    tenant_id: string;
    intents: string[];
    traffic_percent: number;
    channel: "private";
    sender_role: "candidate";
  };
  invalidated_at: string | null;
  invalidation_reason: string | null;
}

export class ModelAdapterCanaryApprovalStore {
  constructor(private readonly filePath: string) {}

  read(): ModelAdapterCanaryApproval | null {
    try {
      if (!existsSync(this.filePath)) return null;
      const value = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<ModelAdapterCanaryApproval>;
      if (
        value.schema_version !== 1
        || typeof value.approval_id !== "string"
        || typeof value.approval_generation !== "string"
        || value.issued_by !== "owner_dashboard_token"
        || typeof value.scope !== "object"
        || value.scope === null
      ) return null;
      return value as ModelAdapterCanaryApproval;
    } catch {
      return null;
    }
  }

  write(approval: ModelAdapterCanaryApproval): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    writeFileSync(temporary, JSON.stringify(approval, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.filePath);
  }

  isValid(now: Date = new Date()): boolean {
    const approval = this.read();
    return approval !== null
      && approval.approved
      && approval.invalidated_at === null
      && now.getTime() < new Date(approval.expires_at).getTime();
  }

  invalidate(reason: string, now: Date = new Date()): boolean {
    const approval = this.read();
    if (!approval || approval.invalidated_at !== null) return false;
    this.write({
      ...approval,
      approved: false,
      invalidated_at: now.toISOString(),
      invalidation_reason: reason,
    });
    return true;
  }
}
