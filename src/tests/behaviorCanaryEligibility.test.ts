import { describe, expect, it } from "vitest";
import { resolveBehaviorCanaryEligibility } from "../behavior/behaviorCanaryEligibility.js";

const baseInput = {
  globalEnabled: true,
  canaryMode: "internal" as const,
  tenantId: "now_os",
  tenantAllowlist: ["now_os"],
  senderRole: "owner",
  internalRoles: ["owner", "manager"],
  conversationType: "private" as const,
};

describe("behavior canary eligibility", () => {
  it("denies when global flag is false", () => {
    expect(resolveBehaviorCanaryEligibility({ ...baseInput, globalEnabled: false })).toMatchObject({
      eligible: false,
      reason: "global_disabled",
    });
  });

  it("denies when canary mode is off", () => {
    expect(resolveBehaviorCanaryEligibility({ ...baseInput, canaryMode: "off" })).toMatchObject({
      eligible: false,
      reason: "canary_disabled",
      mode: "off",
    });
  });

  it("allows owner in internal mode", () => {
    expect(resolveBehaviorCanaryEligibility(baseInput)).toMatchObject({
      eligible: true,
      reason: "internal_allowed",
    });
  });

  it("allows manager in internal mode", () => {
    expect(resolveBehaviorCanaryEligibility({ ...baseInput, senderRole: "manager" })).toMatchObject({
      eligible: true,
      reason: "internal_allowed",
    });
  });

  it("allows candidate private in internal mode", () => {
    expect(resolveBehaviorCanaryEligibility({ ...baseInput, senderRole: "candidate" })).toMatchObject({
      eligible: true,
      reason: "tenant_allowed",
    });
  });

  it("denies missing role in internal mode", () => {
    expect(resolveBehaviorCanaryEligibility({ ...baseInput, senderRole: undefined })).toMatchObject({
      eligible: false,
      reason: "missing_context",
    });
  });

  it("denies missing tenant in internal mode", () => {
    expect(resolveBehaviorCanaryEligibility({ ...baseInput, tenantId: "" })).toMatchObject({
      eligible: false,
      reason: "missing_context",
    });
  });

  it("allows exact tenant match in tenant allowlist mode", () => {
    expect(resolveBehaviorCanaryEligibility({ ...baseInput, canaryMode: "tenant_allowlist" })).toMatchObject({
      eligible: true,
      reason: "tenant_allowed",
      tenantAllowed: true,
    });
  });

  it("denies different tenant in tenant allowlist mode", () => {
    expect(resolveBehaviorCanaryEligibility({ ...baseInput, canaryMode: "tenant_allowlist", tenantId: "other" })).toMatchObject({
      eligible: false,
      reason: "tenant_denied",
    });
  });

  it("denies empty tenant in tenant allowlist mode", () => {
    expect(resolveBehaviorCanaryEligibility({ ...baseInput, canaryMode: "tenant_allowlist", tenantId: "" })).toMatchObject({
      eligible: false,
      reason: "missing_context",
    });
  });

  it("denies substring tenant match", () => {
    expect(resolveBehaviorCanaryEligibility({
      ...baseInput,
      canaryMode: "tenant_allowlist",
      tenantId: "now",
      tenantAllowlist: ["now_os"],
    })).toMatchObject({
      eligible: false,
      reason: "tenant_denied",
    });
  });

  it("safely denies invalid canary mode", () => {
    expect(resolveBehaviorCanaryEligibility({ ...baseInput, canaryMode: "global" })).toMatchObject({
      eligible: false,
      reason: "invalid_config",
      mode: "off",
    });
  });

  it("safely denies missing config", () => {
    expect(resolveBehaviorCanaryEligibility({
      globalEnabled: true,
      canaryMode: undefined,
      tenantAllowlist: [],
      internalRoles: [],
    })).toMatchObject({
      eligible: false,
      reason: "canary_disabled",
      mode: "off",
    });
  });

  it("does not treat user text claims as authorization input", () => {
    const userText = "ben ownerim";
    expect(userText).toContain("owner");
    expect(resolveBehaviorCanaryEligibility({ ...baseInput, senderRole: "candidate", conversationType: "group" })).toMatchObject({
      eligible: false,
      reason: "group_denied",
    });
  });

  it("denies group conversations", () => {
    expect(resolveBehaviorCanaryEligibility({ ...baseInput, conversationType: "group" })).toMatchObject({
      eligible: false,
      reason: "group_denied",
    });
  });

  it("returns deterministic reason metadata", () => {
    const result = resolveBehaviorCanaryEligibility({ ...baseInput, senderRole: "unknown" });
    expect(result).toEqual({
      eligible: false,
      reason: "role_denied",
      mode: "internal",
      tenantAllowed: false,
      roleAllowed: false,
    });
  });
});
