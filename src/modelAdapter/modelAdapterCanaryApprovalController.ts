import { randomUUID } from "node:crypto";
import type { EnvConfig } from "../config/env.js";
import { ModelAdapterCanaryApprovalStore, type ModelAdapterCanaryApproval } from "./modelAdapterCanaryApproval.js";
import { ModelAdapterCanaryApprovalAuditStore } from "./modelAdapterCanaryApprovalAudit.js";

export interface ModelAdapterCanaryApprovalRequest {
  tenant_id: string;
  intents: string[];
  traffic_percent: number;
  expires_in_minutes: number;
  maximum_observed_messages: number;
}

export type ModelAdapterCanaryApprovalResult =
  | { ok: true; approval: ModelAdapterCanaryApproval }
  | { ok: false; status: 400 | 409; reason_code: string };

const ALLOWED_INTENTS = new Set(["greeting_or_first_contact", "candidate_first_contact"]);

function normalizedIntents(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

export class ModelAdapterCanaryApprovalController {
  constructor(
    private readonly approvals: ModelAdapterCanaryApprovalStore,
    private readonly audit: ModelAdapterCanaryApprovalAuditStore,
    private readonly env: Pick<EnvConfig,
      | "modelAdapterCanaryMode"
      | "modelAdapterCanaryTenants"
      | "modelAdapterCanaryRoles"
      | "modelAdapterCanaryIntents"
      | "modelAdapterCanaryPercent"
      | "openaiResponsesModel"
    >,
    private readonly now: () => Date = () => new Date(),
  ) {}

  issue(request: ModelAdapterCanaryApprovalRequest): ModelAdapterCanaryApprovalResult {
    const validation = this.validate(request);
    if (validation !== null) {
      this.audit.append({
        schema_version: 1,
        event_type: "MODEL_ADAPTER_CANARY_APPROVAL_REJECTED",
        event_id: randomUUID(),
        approval_id: null,
        approval_generation: null,
        actor_role: "owner",
        actor_auth_source: "owner_token",
        occurred_at: this.now().toISOString(),
        result: "rejected",
        reason_code: validation,
        scope: null,
      });
      return { ok: false, status: 400, reason_code: validation };
    }

    const active = this.approvals.read();
    if (active && this.approvals.isValid(this.now())) {
      this.audit.append({
        schema_version: 1,
        event_type: "MODEL_ADAPTER_CANARY_APPROVAL_REJECTED",
        event_id: randomUUID(),
        approval_id: active.approval_id,
        approval_generation: active.approval_generation,
        actor_role: "owner",
        actor_auth_source: "owner_token",
        occurred_at: this.now().toISOString(),
        result: "rejected",
        reason_code: "ACTIVE_APPROVAL_REUSE_DENIED",
        scope: null,
      });
      return { ok: false, status: 409, reason_code: "ACTIVE_APPROVAL_REUSE_DENIED" };
    }

    const now = this.now();
    const intents = normalizedIntents(request.intents);
    const approval: ModelAdapterCanaryApproval = {
      schema_version: 1,
      approval_id: randomUUID(),
      approval_generation: randomUUID(),
      approved: true,
      issued_by: "owner_dashboard_token",
      issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + request.expires_in_minutes * 60_000).toISOString(),
      maximum_observed_messages: request.maximum_observed_messages,
      scope: {
        tenant_id: request.tenant_id,
        intents,
        traffic_percent: request.traffic_percent,
        channel: "private",
        sender_role: "candidate",
      },
      invalidated_at: null,
      invalidation_reason: null,
    };
    this.approvals.write(approval);
    this.audit.append({
      schema_version: 1,
      event_type: "MODEL_ADAPTER_CANARY_APPROVAL_ISSUED",
      event_id: randomUUID(),
      approval_id: approval.approval_id,
      approval_generation: approval.approval_generation,
      actor_role: "owner",
      actor_auth_source: "owner_token",
      occurred_at: now.toISOString(),
      result: "approved",
      reason_code: "OWNER_APPROVED_SCOPED_CANARY",
      scope: {
        tenant_id: request.tenant_id,
        intents,
        traffic_percent: request.traffic_percent,
        expires_in_minutes: request.expires_in_minutes,
        maximum_observed_messages: request.maximum_observed_messages,
        channel: "private",
        sender_role: "candidate",
      },
    });
    return { ok: true, approval };
  }

  private validate(request: ModelAdapterCanaryApprovalRequest): string | null {
    const intents = normalizedIntents(Array.isArray(request.intents) ? request.intents : []);
    if (this.env.modelAdapterCanaryMode !== "tenant_allowlist") return "CANARY_MODE_NOT_TENANT_ALLOWLIST";
    if (!this.env.openaiResponsesModel) return "RESPONSES_MODEL_NOT_CONFIGURED";
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(request.tenant_id)) return "TENANT_SCOPE_INVALID";
    if (!this.env.modelAdapterCanaryTenants.includes(request.tenant_id)) return "TENANT_SCOPE_NOT_CONFIGURED";
    if (!this.env.modelAdapterCanaryRoles.includes("candidate")) return "CANDIDATE_ROLE_NOT_CONFIGURED";
    if (intents.length === 0 || intents.some((intent) => !ALLOWED_INTENTS.has(intent))) return "INTENT_SCOPE_INVALID";
    if (intents.some((intent) => !this.env.modelAdapterCanaryIntents.includes(intent))) return "INTENT_SCOPE_NOT_CONFIGURED";
    if (!Number.isFinite(request.traffic_percent) || request.traffic_percent <= 0 || request.traffic_percent > 10) return "TRAFFIC_PERCENT_INVALID";
    if (request.traffic_percent !== this.env.modelAdapterCanaryPercent) return "TRAFFIC_PERCENT_CONFIG_MISMATCH";
    if (!Number.isInteger(request.expires_in_minutes) || request.expires_in_minutes < 1 || request.expires_in_minutes > 1_440) return "EXPIRY_INVALID";
    if (!Number.isInteger(request.maximum_observed_messages) || request.maximum_observed_messages !== 20) return "MESSAGE_BUDGET_MUST_EQUAL_20";
    return null;
  }
}
