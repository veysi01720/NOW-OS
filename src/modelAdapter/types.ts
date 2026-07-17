import type { SenderRole } from "../config/roles.js";
import type { ChatType, BackendContextPayloadV1 } from "../contracts/backendContextPayload.js";

export interface NormalizedAssistantResponse {
  reply: string;
  internal_boss_note: string;
}

export interface ModelAdapterInput {
  tenantId: string;
  conversationId: string;
  mode: string;
  senderRole: SenderRole;
  channelType: ChatType;
  normalizedUserMessage: string;
  contextPayload: BackendContextPayloadV1;
  retrievedKnowledge?: {
    sourceCount: number;
    ruleIds: string[];
  };
  behaviorContext?: BackendContextPayloadV1["behavior_context"];
  responseContractVersion: "1.0";
  execution?: {
    signal?: AbortSignal;
    timeoutMs?: number;
  };
  metadata: {
    traceId: string;
    knowledgeVersion?: string;
    featureFlags: {
      behavior_orchestrator_enabled: boolean;
      model_adapter_layer_enabled: boolean;
      model_adapter_canary_mode: "off" | "internal" | "tenant_allowlist";
      model_adapter_canary_tenants: string[];
      model_adapter_canary_roles: string[];
    };
  };
}

export interface ModelAdapterOutput {
  normalizedResponse: NormalizedAssistantResponse | null;
  rawText: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  providerTrace?: {
    provider: string;
    adapter: string;
    response_contract_version: string;
  };
  finishReason?: string;
  rawProviderResponseStored: false;
}

export interface ModelAdapterHealth {
  ok: boolean;
  provider: string;
  lastErrorClass?: string;
  supportsResponseContractVersion: "1.0";
}
