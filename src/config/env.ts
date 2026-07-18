import "dotenv/config";
import {
  BACKEND_CONTEXT_VERSION,
  SUPPORTED_ASSISTANT_RESPONSE_CONTRACT_VERSION,
  type VersionConfig
} from "./versions.js";

export interface EnvConfig {
  port: number;
  evolutionApiBaseUrl: string;
  evolutionInstance: string;
  evolutionApiKey: string;
  openaiApiKey: string;
  openaiAssistantId: string;
  openaiVectorStoreId?: string;
  realOpenaiPublishEnabled: boolean;
  ownerPhoneNumbers: string[];
  managerPhoneNumbers: string[];
  approvedApps: string[];
  dashboardAdminToken: string;
  dashboardOwnerToken: string;
  dashboardManagerToken: string;
  webhookQueueMode: "off" | "dual_write" | "queue_only";
  outboundQueueMode: "off" | "enqueue_shadow" | "queue_only";
  fastAckEnabled: boolean;
  workersEnabled: boolean;
  behaviorOrchestratorEnabled: boolean;
  behaviorCanaryMode: "off" | "internal" | "tenant_allowlist";
  behaviorCanaryTenants: string[];
  behaviorCanaryRoles: string[];
  behaviorTenantCanaryEnabled: boolean;
  modelAdapterLayerEnabled: boolean;
  modelAdapterCanaryMode: "off" | "internal" | "tenant_allowlist";
  modelAdapterCanaryTenants: string[];
  modelAdapterCanaryRoles: string[];
  modelAdapterCanaryIntents: string[];
  modelAdapterCanaryPercent: number;
  modelExecutionTimeoutEnabled: boolean;
  modelExecutionTimeoutMs: number;
  responsesShadowEnabled: boolean;
  responsesShadowMode: "off" | "internal" | "tenant_allowlist";
  responsesShadowTenants: string[];
  responsesShadowRoles: string[];
  responsesShadowTimeoutMs: number;
  openaiResponsesModel?: string;
  conversationDecisionV2Enabled?: boolean;
  versions: VersionConfig;
}

function readEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required env: ${name}`);
  }
  return value.trim();
}

function parseCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const candidate = Number(value ?? fallback);
  if (!Number.isInteger(candidate) || candidate <= 0) return fallback;
  return candidate;
}

function parsePercentage(value: string | undefined, fallback: number): number {
  const candidate = Number(value ?? fallback);
  if (!Number.isFinite(candidate) || candidate < 0 || candidate > 100) return fallback;
  return candidate;
}

function parseEnum<T extends string>(name: string, value: string | undefined, allowed: readonly T[], fallback: T): T {
  const candidate = (value ?? fallback).trim() as T;
  if (!allowed.includes(candidate)) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return candidate;
}

function parseSafeEnum<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  const candidate = (value ?? fallback).trim() as T;
  return allowed.includes(candidate) ? candidate : fallback;
}

export function loadEnv(): EnvConfig {
  const assistantContractVersion = readEnv(
    "ASSISTANT_RESPONSE_CONTRACT_VERSION",
    SUPPORTED_ASSISTANT_RESPONSE_CONTRACT_VERSION
  );
  const backendContextVersion = readEnv("BACKEND_CONTEXT_VERSION", BACKEND_CONTEXT_VERSION);

  if (assistantContractVersion !== SUPPORTED_ASSISTANT_RESPONSE_CONTRACT_VERSION) {
    throw new Error("ASSISTANT_RESPONSE_CONTRACT_VERSION must be 1.0");
  }

  if (backendContextVersion !== BACKEND_CONTEXT_VERSION) {
    throw new Error("BACKEND_CONTEXT_VERSION must be 1.0");
  }

  return {
    port: parsePort(readEnv("PORT", "3000")),
    evolutionApiBaseUrl: readEnv("EVOLUTION_API_BASE_URL"),
    evolutionInstance: readEnv("EVOLUTION_INSTANCE"),
    evolutionApiKey: readEnv("EVOLUTION_API_KEY"),
    openaiApiKey: readEnv("OPENAI_API_KEY"),
    openaiAssistantId: readEnv("OPENAI_ASSISTANT_ID"),
    openaiVectorStoreId: process.env.OPENAI_VECTOR_STORE_ID,
    realOpenaiPublishEnabled: process.env.REAL_OPENAI_PUBLISH_ENABLED === "true",
    ownerPhoneNumbers: parseCsv(process.env.OWNER_PHONE_NUMBERS),
    managerPhoneNumbers: parseCsv(process.env.MANAGER_PHONE_NUMBERS),
    approvedApps: parseCsv(process.env.APPROVED_APPS),
    dashboardAdminToken: process.env.DASHBOARD_ADMIN_TOKEN ?? "",
    dashboardOwnerToken: process.env.DASHBOARD_OWNER_TOKEN ?? "",
    dashboardManagerToken: process.env.DASHBOARD_MANAGER_TOKEN ?? "",
    webhookQueueMode: parseEnum("WEBHOOK_QUEUE_MODE", process.env.WEBHOOK_QUEUE_MODE, ["off", "dual_write", "queue_only"] as const, "off"),
    outboundQueueMode: parseEnum("OUTBOUND_QUEUE_MODE", process.env.OUTBOUND_QUEUE_MODE, ["off", "enqueue_shadow", "queue_only"] as const, "off"),
    fastAckEnabled: process.env.FAST_ACK_ENABLED === "true",
    workersEnabled: process.env.WORKERS_ENABLED === "true",
    behaviorOrchestratorEnabled: process.env.BEHAVIOR_ORCHESTRATOR_ENABLED === "true",
    behaviorCanaryMode: parseSafeEnum(process.env.BEHAVIOR_CANARY_MODE, ["off", "internal", "tenant_allowlist"] as const, "off"),
    behaviorCanaryTenants: parseCsv(process.env.BEHAVIOR_CANARY_TENANT_ALLOWLIST),
    behaviorCanaryRoles: parseCsv(process.env.BEHAVIOR_CANARY_INTERNAL_ROLES ?? "owner,manager"),
    behaviorTenantCanaryEnabled: process.env.BEHAVIOR_TENANT_CANARY_ENABLED === "true",
    modelAdapterLayerEnabled: process.env.MODEL_ADAPTER_LAYER_ENABLED === "true",
    modelAdapterCanaryMode: parseEnum("MODEL_ADAPTER_CANARY_MODE", process.env.MODEL_ADAPTER_CANARY_MODE, ["off", "internal", "tenant_allowlist"] as const, "off"),
    modelAdapterCanaryTenants: parseCsv(process.env.MODEL_ADAPTER_CANARY_TENANTS),
    modelAdapterCanaryRoles: parseCsv(process.env.MODEL_ADAPTER_CANARY_ROLES ?? "owner,manager"),
    modelAdapterCanaryIntents: parseCsv(process.env.MODEL_ADAPTER_CANARY_INTENTS),
    modelAdapterCanaryPercent: parsePercentage(process.env.MODEL_ADAPTER_CANARY_PERCENT, 0),
    modelExecutionTimeoutEnabled: process.env.MODEL_EXECUTION_TIMEOUT_ENABLED === "true",
    modelExecutionTimeoutMs: parsePositiveInteger(process.env.MODEL_EXECUTION_TIMEOUT_MS, 45_000),
    responsesShadowEnabled: process.env.RESPONSES_SHADOW_ENABLED === "true",
    responsesShadowMode: parseSafeEnum(process.env.RESPONSES_SHADOW_MODE, ["off", "internal", "tenant_allowlist"] as const, "off"),
    responsesShadowTenants: parseCsv(process.env.RESPONSES_SHADOW_TENANTS),
    responsesShadowRoles: parseCsv(process.env.RESPONSES_SHADOW_ROLES),
    responsesShadowTimeoutMs: parsePositiveInteger(process.env.RESPONSES_SHADOW_TIMEOUT_MS, 15_000),
    openaiResponsesModel: process.env.OPENAI_RESPONSES_MODEL?.trim() || undefined,
    conversationDecisionV2Enabled: process.env.CONVERSATION_DECISION_V2_ENABLED !== "false",
    versions: {
      assistant_response_contract_version: SUPPORTED_ASSISTANT_RESPONSE_CONTRACT_VERSION,
      system_prompt_version: readEnv("SYSTEM_PROMPT_VERSION"),
      knowledge_base_version: readEnv("KNOWLEDGE_BASE_VERSION"),
      backend_context_version: BACKEND_CONTEXT_VERSION,
      state_machine_version: readEnv("STATE_MACHINE_VERSION")
    }
  };
}
