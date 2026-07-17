import type { SenderRole } from "../config/roles.js";
import type { ChatType } from "../contracts/backendContextPayload.js";

export type ModelAdapterCanaryMode = "off" | "internal" | "tenant_allowlist";

export type AdapterExecutionReason =
  | "disabled_global"
  | "disabled_mode_off"
  | "enabled_global"
  | "enabled_internal_role"
  | "enabled_tenant_allowlist"
  | "denied_not_allowed_scope"
  | "denied_empty_allowlist";

export type AdapterCanaryScope = "none" | "off" | "internal" | "tenant_allowlist";

export interface AdapterExecutionDecision {
  useAdapterLayer: boolean;
  adapterName: "assistant_adapter";
  provider: "openai_assistant";
  reason: AdapterExecutionReason;
  canaryScope: AdapterCanaryScope;
}

export interface AdapterSelectionInput {
  tenantId: string;
  senderRole: SenderRole;
  channelType: ChatType;
  mode: string;
  featureFlags: {
    model_adapter_layer_enabled: boolean;
    model_adapter_canary_mode: ModelAdapterCanaryMode;
    model_adapter_canary_tenants: string[];
    model_adapter_canary_roles: string[];
  };
  traceId: string;
}

function allowedRole(input: AdapterSelectionInput): boolean {
  return input.featureFlags.model_adapter_canary_roles.includes(input.senderRole);
}

export function resolveModelAdapterExecution(input: AdapterSelectionInput): AdapterExecutionDecision {
  if (input.featureFlags.model_adapter_layer_enabled) {
    return {
      useAdapterLayer: true,
      adapterName: "assistant_adapter",
      provider: "openai_assistant",
      reason: "enabled_global",
      canaryScope: "none",
    };
  }

  if (input.featureFlags.model_adapter_canary_mode === "off") {
    return {
      useAdapterLayer: false,
      adapterName: "assistant_adapter",
      provider: "openai_assistant",
      reason: "disabled_mode_off",
      canaryScope: "off",
    };
  }

  if (input.featureFlags.model_adapter_canary_mode === "internal") {
    const enabled = allowedRole(input);
    return {
      useAdapterLayer: enabled,
      adapterName: "assistant_adapter",
      provider: "openai_assistant",
      reason: enabled ? "enabled_internal_role" : "denied_not_allowed_scope",
      canaryScope: "internal",
    };
  }

  const tenantAllowed =
    input.featureFlags.model_adapter_canary_tenants.length > 0 &&
    input.featureFlags.model_adapter_canary_tenants.includes(input.tenantId);
  if (input.featureFlags.model_adapter_canary_tenants.length === 0) {
    return {
      useAdapterLayer: false,
      adapterName: "assistant_adapter",
      provider: "openai_assistant",
      reason: "denied_empty_allowlist",
      canaryScope: "tenant_allowlist",
    };
  }
  const enabled = tenantAllowed && allowedRole(input);
  return {
    useAdapterLayer: enabled,
    adapterName: "assistant_adapter",
    provider: "openai_assistant",
    reason: enabled ? "enabled_tenant_allowlist" : "denied_not_allowed_scope",
    canaryScope: "tenant_allowlist",
  };
}
