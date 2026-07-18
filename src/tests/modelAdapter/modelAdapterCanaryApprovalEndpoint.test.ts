import Fastify from "fastify";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerDashboardRoutes } from "../../bridge/dashboardRoutes.js";
import type { EnvConfig } from "../../config/env.js";
import { ModelAdapterCanaryApprovalStore } from "../../modelAdapter/modelAdapterCanaryApproval.js";
import { ModelAdapterCanaryApprovalAuditStore } from "../../modelAdapter/modelAdapterCanaryApprovalAudit.js";
import { ModelAdapterCanaryApprovalController } from "../../modelAdapter/modelAdapterCanaryApprovalController.js";

describe("model adapter canary owner approval endpoint", () => {
  let directory: string;
  let app: ReturnType<typeof Fastify>;
  let approvals: ModelAdapterCanaryApprovalStore;
  let audit: ModelAdapterCanaryApprovalAuditStore;
  const approvalPath = () => join(directory, "approval.json");
  const auditPath = () => join(directory, "approval-audit.ndjson");

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "nowos-canary-approval-"));
    approvals = new ModelAdapterCanaryApprovalStore(approvalPath());
    audit = new ModelAdapterCanaryApprovalAuditStore(auditPath());
    const env = {
      dashboardOwnerToken: "owner-token",
      dashboardManagerToken: "manager-token",
      dashboardAdminToken: "legacy-token",
      modelAdapterCanaryMode: "tenant_allowlist",
      modelAdapterCanaryTenants: ["now_os"],
      modelAdapterCanaryRoles: ["candidate"],
      modelAdapterCanaryIntents: ["greeting_or_first_contact", "candidate_first_contact"],
      modelAdapterCanaryPercent: 10,
      openaiResponsesModel: "configured-model",
    } as EnvConfig;
    const controller = new ModelAdapterCanaryApprovalController(approvals, audit, env);
    app = Fastify({ logger: false });
    registerDashboardRoutes(app, {
      env,
      modelAdapterCanaryApprovalController: controller,
      maintenanceStore: { isEnabled: () => false } as any,
      queueStore: {} as any,
      actionAuditStore: { logAction: () => undefined } as any,
      reportDataSource: {} as any,
    });
  });

  afterEach(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const validPayload = () => ({
    tenant_id: "now_os",
    intents: ["greeting_or_first_contact", "candidate_first_contact"],
    traffic_percent: 10,
    expires_in_minutes: 15,
    maximum_observed_messages: 20,
  });

  it("issues a scoped, fresh owner approval and writes an append-only audit event", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/dashboard/actions/model-adapter-canary/approve",
      headers: { "x-dashboard-token": "owner-token" },
      payload: validPayload(),
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({
      status: "approved",
      maximum_observed_messages: 20,
      scope: {
        tenant_id: "now_os",
        intents: ["candidate_first_contact", "greeting_or_first_contact"],
        traffic_percent: 10,
        channel: "private",
        sender_role: "candidate",
      },
    });
    expect(body.approval_id).toEqual(expect.any(String));
    expect(body.approval_generation).toEqual(expect.any(String));

    const persisted = approvals.read();
    expect(persisted?.approval_id).toBe(body.approval_id);
    expect(persisted?.issued_by).toBe("owner_dashboard_token");
    expect(audit.readAll()).toEqual([
      expect.objectContaining({
        event_type: "MODEL_ADAPTER_CANARY_APPROVAL_ISSUED",
        actor_role: "owner",
        actor_auth_source: "owner_token",
        result: "approved",
        scope: expect.objectContaining({ tenant_id: "now_os", traffic_percent: 10 }),
      }),
    ]);
    if (process.platform !== "win32") {
      expect(statSync(approvalPath()).mode & 0o777).toBe(0o600);
      expect(statSync(auditPath()).mode & 0o777).toBe(0o600);
    }
  });

  it("requires a fresh approval and never reuses an active approval", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/dashboard/actions/model-adapter-canary/approve",
      headers: { "x-dashboard-token": "owner-token" },
      payload: validPayload(),
    });
    const firstApproval = approvals.read();
    const second = await app.inject({
      method: "POST",
      url: "/dashboard/actions/model-adapter-canary/approve",
      headers: { "x-dashboard-token": "owner-token" },
      payload: validPayload(),
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ reason_code: "ACTIVE_APPROVAL_REUSE_DENIED" });
    expect(approvals.read()?.approval_generation).toBe(firstApproval?.approval_generation);
    expect(audit.readAll().map((event) => event.event_type)).toEqual([
      "MODEL_ADAPTER_CANARY_APPROVAL_ISSUED",
      "MODEL_ADAPTER_CANARY_APPROVAL_REJECTED",
    ]);
  });

  it("creates a new generation after the prior approval is invalidated", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/dashboard/actions/model-adapter-canary/approve",
      headers: { "x-dashboard-token": "owner-token" },
      payload: validPayload(),
    });
    const firstGeneration = first.json().approval_generation;
    approvals.invalidate("operator_disarm", new Date());

    const second = await app.inject({
      method: "POST",
      url: "/dashboard/actions/model-adapter-canary/approve",
      headers: { "x-dashboard-token": "owner-token" },
      payload: validPayload(),
    });

    expect(second.statusCode).toBe(201);
    expect(second.json().approval_generation).not.toBe(firstGeneration);
    expect(audit.readAll().filter((event) => event.event_type === "MODEL_ADAPTER_CANARY_APPROVAL_ISSUED")).toHaveLength(2);
  });

  it("denies manager and legacy-admin credentials", async () => {
    for (const token of ["manager-token", "legacy-token"]) {
      const response = await app.inject({
        method: "POST",
        url: "/dashboard/actions/model-adapter-canary/approve",
        headers: { "x-dashboard-token": token },
        payload: validPayload(),
      });
      expect(response.statusCode).toBe(403);
    }
    expect(approvals.read()).toBeNull();
  });

  it("rejects incomplete or out-of-scope approval requests", async () => {
    const invalid = [
      { ...validPayload(), tenant_id: "wrong_tenant" },
      { ...validPayload(), intents: ["owner_report"] },
      { ...validPayload(), traffic_percent: 11 },
      { ...validPayload(), expires_in_minutes: 0 },
      { ...validPayload(), maximum_observed_messages: 19 },
    ];
    for (const payload of invalid) {
      const response = await app.inject({
        method: "POST",
        url: "/dashboard/actions/model-adapter-canary/approve",
        headers: { "x-dashboard-token": "owner-token" },
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
    expect(approvals.read()).toBeNull();
    expect(audit.readAll()).toHaveLength(invalid.length);
  });
});
