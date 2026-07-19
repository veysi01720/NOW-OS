import { describe, expect, it } from "vitest";
import { resolveModelAdapterExecution } from "../../modelAdapter/modelAdapterSelection.js";

const baseInput = {
  tenantId: "now_os",
  senderRole: "owner" as const,
  channelType: "private" as const,
  mode: "answer_mode",
  inferredIntent: "owner_answer",
  trafficBucket: 0,
  traceId: "corr_test",
  featureFlags: {
    model_adapter_layer_enabled: false,
    model_adapter_canary_mode: "off" as const,
    model_adapter_canary_tenants: [] as string[],
    model_adapter_canary_roles: ["owner", "manager"],
    model_adapter_canary_intents: ["owner_answer"],
    model_adapter_canary_percent: 100,
  },
};

describe("model adapter scoped canary flag", () => {
  it("defaults mode off to legacy-equivalent boundary path", () => {
    const decision = resolveModelAdapterExecution(baseInput);

    expect(decision.useAdapterLayer).toBe(false);
    expect(decision.reason).toBe("disabled_mode_off");
    expect(decision.canaryScope).toBe("off");
  });

  it("allows internal owner or manager roles only", () => {
    const ownerDecision = resolveModelAdapterExecution({
      ...baseInput,
      featureFlags: { ...baseInput.featureFlags, model_adapter_canary_mode: "internal" },
    });
    const candidateDecision = resolveModelAdapterExecution({
      ...baseInput,
      senderRole: "candidate",
      featureFlags: { ...baseInput.featureFlags, model_adapter_canary_mode: "internal" },
    });

    expect(ownerDecision.useAdapterLayer).toBe(true);
    expect(ownerDecision.reason).toBe("enabled_internal_role");
    expect(candidateDecision.useAdapterLayer).toBe(false);
    expect(candidateDecision.reason).toBe("denied_not_allowed_scope");
  });

  it("allows tenant allowlist only when tenant and role are both in scope", () => {
    const allowed = resolveModelAdapterExecution({
      ...baseInput,
      featureFlags: {
        ...baseInput.featureFlags,
        model_adapter_canary_mode: "tenant_allowlist",
        model_adapter_canary_tenants: ["now_os"],
      },
    });
    const emptyAllowlist = resolveModelAdapterExecution({
      ...baseInput,
      featureFlags: {
        ...baseInput.featureFlags,
        model_adapter_canary_mode: "tenant_allowlist",
        model_adapter_canary_tenants: [],
      },
    });
    const normalUser = resolveModelAdapterExecution({
      ...baseInput,
      senderRole: "candidate",
      featureFlags: {
        ...baseInput.featureFlags,
        model_adapter_canary_mode: "tenant_allowlist",
        model_adapter_canary_tenants: ["now_os"],
      },
    });

    expect(allowed.useAdapterLayer).toBe(true);
    expect(allowed.reason).toBe("enabled_tenant_allowlist");
    expect(emptyAllowlist.useAdapterLayer).toBe(false);
    expect(emptyAllowlist.reason).toBe("denied_empty_allowlist");
    expect(normalUser.useAdapterLayer).toBe(false);
    expect(normalUser.reason).toBe("denied_not_allowed_scope");
  });

  it("uses global adapter flag as explicit all-scope override", () => {
    const decision = resolveModelAdapterExecution({
      ...baseInput,
      senderRole: "candidate",
      featureFlags: {
        ...baseInput.featureFlags,
        model_adapter_layer_enabled: true,
        model_adapter_canary_mode: "off",
      },
    });

    expect(decision.useAdapterLayer).toBe(true);
    expect(decision.reason).toBe("enabled_global");
    expect(decision.provider).toBe("openai_assistant");
    expect(decision.adapterName).toBe("assistant_adapter");
  });

  it("returns only sanitized decision data", () => {
    const decisionText = JSON.stringify(resolveModelAdapterExecution({
      ...baseInput,
      tenantId: "tenant_safe",
      traceId: "corr_safe",
    }));

    expect(decisionText).not.toContain("@s.whatsapp.net");
    expect(decisionText).not.toContain("@g.us");
    expect(decisionText).not.toContain("905");
    expect(decisionText).not.toContain("corr_safe");
  });
});
