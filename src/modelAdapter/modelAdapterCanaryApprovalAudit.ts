import { appendFileSync, chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export interface ModelAdapterCanaryApprovalAuditEvent {
  schema_version: 1;
  event_type: "MODEL_ADAPTER_CANARY_APPROVAL_ISSUED" | "MODEL_ADAPTER_CANARY_APPROVAL_REJECTED";
  event_id: string;
  approval_id: string | null;
  approval_generation: string | null;
  actor_role: "owner";
  actor_auth_source: "owner_token";
  occurred_at: string;
  result: "approved" | "rejected";
  reason_code: string;
  scope: {
    tenant_id: string;
    intents: string[];
    traffic_percent: number;
    expires_in_minutes: number;
    maximum_observed_messages: number;
    channel: "private";
    sender_role: "candidate";
  } | null;
}

export class ModelAdapterCanaryApprovalAuditStore {
  constructor(private readonly filePath: string) {}

  append(event: ModelAdapterCanaryApprovalAuditEvent): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    if (!existsSync(this.filePath)) {
      const descriptor = openSync(this.filePath, "a", 0o600);
      closeSync(descriptor);
    }
    appendFileSync(this.filePath, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
    chmodSync(this.filePath, 0o600);
  }

  readAll(): ModelAdapterCanaryApprovalAuditEvent[] {
    try {
      return readFileSync(this.filePath, "utf8")
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as ModelAdapterCanaryApprovalAuditEvent);
    } catch {
      return [];
    }
  }
}
