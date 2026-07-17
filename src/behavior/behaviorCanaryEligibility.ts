import type { SenderRole } from "../config/roles.js";
import type { ChatType } from "../contracts/backendContextPayload.js";

export type BehaviorCanaryMode = "off" | "internal" | "tenant_allowlist";

export type BehaviorEligibilityReason =
  | "global_disabled"
  | "canary_disabled"
  | "internal_allowed"
  | "tenant_allowed"
  | "role_denied"
  | "tenant_denied"
  | "invalid_config"
  | "missing_context"
  | "group_denied";

export interface BehaviorCanaryEligibilityInput {
  globalEnabled: boolean;
  canaryMode: BehaviorCanaryMode | string | undefined;
  tenantId?: string;
  tenantAllowlist: string[];
  senderRole?: SenderRole | string;
  internalRoles: string[];
  conversationType?: ChatType;
}

export interface BehaviorCanaryEligibilityResult {
  eligible: boolean;
  reason: BehaviorEligibilityReason;
  mode: BehaviorCanaryMode;
  tenantAllowed: boolean;
  roleAllowed: boolean;
}

const SUPPORTED_MODES: BehaviorCanaryMode[] = ["off", "internal", "tenant_allowlist"];

function normalizeList(values: string[]): string[] {
  return values.map((value) => value.trim().toLowerCase()).filter(Boolean);
}

function normalizeMode(mode: BehaviorCanaryEligibilityInput["canaryMode"]): BehaviorCanaryMode | null {
  const normalized = (mode ?? "off").trim().toLowerCase();
  return SUPPORTED_MODES.includes(normalized as BehaviorCanaryMode)
    ? (normalized as BehaviorCanaryMode)
    : null;
}

export function resolveBehaviorCanaryEligibility(
  input: BehaviorCanaryEligibilityInput,
): BehaviorCanaryEligibilityResult {
  const mode = normalizeMode(input.canaryMode);
  
  // Make INTELLIGENCE_CORE the primary route for candidate private chat, ignoring canary
  const isCandidatePrivate = input.senderRole === "candidate" && input.conversationType === "private";

  if (mode === null) {
    return {
      eligible: isCandidatePrivate ? true : false,
      reason: isCandidatePrivate ? "tenant_allowed" : "invalid_config",
      mode: "off",
      tenantAllowed: isCandidatePrivate ? true : false,
      roleAllowed: isCandidatePrivate ? true : false,
    };
  }

  if (!input.globalEnabled) {
    return {
      eligible: false,
      reason: "global_disabled",
      mode,
      tenantAllowed: false,
      roleAllowed: false,
    };
  }

  if (isCandidatePrivate) {
    return {
      eligible: true,
      reason: "tenant_allowed",
      mode,
      tenantAllowed: true,
      roleAllowed: true,
    };
  }

  if (mode === "off") {
    return {
      eligible: false,
      reason: "canary_disabled",
      mode,
      tenantAllowed: false,
      roleAllowed: false,
    };
  }

  if (!input.senderRole || !input.conversationType) {
    return {
      eligible: false,
      reason: "missing_context",
      mode,
      tenantAllowed: false,
      roleAllowed: false,
    };
  }

  if (input.conversationType === "group") {
    return {
      eligible: false,
      reason: "group_denied",
      mode,
      tenantAllowed: false,
      roleAllowed: false,
    };
  }

  const tenantId = input.tenantId?.trim().toLowerCase() ?? "";
  if (tenantId === "") {
    return {
      eligible: false,
      reason: "missing_context",
      mode,
      tenantAllowed: false,
      roleAllowed: false,
    };
  }

  const normalizedRole = input.senderRole.trim().toLowerCase();
  const allowedRoles = normalizeList(input.internalRoles);
  const roleAllowed = allowedRoles.includes(normalizedRole);

  if (mode === "internal") {
    return {
      eligible: roleAllowed,
      reason: roleAllowed ? "internal_allowed" : "role_denied",
      mode,
      tenantAllowed: false,
      roleAllowed,
    };
  }

  const tenantAllowed = normalizeList(input.tenantAllowlist).includes(tenantId);
  if (!tenantAllowed) {
    return {
      eligible: false,
      reason: "tenant_denied",
      mode,
      tenantAllowed: false,
      roleAllowed,
    };
  }

  return {
    eligible: roleAllowed,
    reason: roleAllowed ? "tenant_allowed" : "role_denied",
    mode,
    tenantAllowed,
    roleAllowed,
  };
}
