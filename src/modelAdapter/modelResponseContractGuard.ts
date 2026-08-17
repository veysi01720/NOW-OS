import type { EnvConfig } from "../config/env.js";
import { CANONICAL_MODEL_RESPONSE_CONTRACT } from "../intelligence/conversation/ConversationDecisionV3Parser.js";

export { CANONICAL_MODEL_RESPONSE_CONTRACT };

export interface ProductionResponseParserRoute {
  route_id: string;
  contract: typeof CANONICAL_MODEL_RESPONSE_CONTRACT;
}

export const PRODUCTION_RESPONSE_PARSER_ROUTES: ProductionResponseParserRoute[] = [
  { route_id: "candidate_private", contract: CANONICAL_MODEL_RESPONSE_CONTRACT },
  { route_id: "owner_private", contract: CANONICAL_MODEL_RESPONSE_CONTRACT },
  { route_id: "manager_private", contract: CANONICAL_MODEL_RESPONSE_CONTRACT },
  { route_id: "group_command", contract: CANONICAL_MODEL_RESPONSE_CONTRACT },
  { route_id: "owner_report", contract: CANONICAL_MODEL_RESPONSE_CONTRACT },
  { route_id: "dashboard_observable_model_path", contract: CANONICAL_MODEL_RESPONSE_CONTRACT },
];

export function assertSingleProductionModelResponseContract(
  env: Pick<
    EnvConfig,
    | "behaviorOrchestratorEnabled"
    | "conversationDecisionV2Enabled"
    | "modelAdapterLayerEnabled"
    | "openaiResponsesModel"
  >,
  isProduction = process.env.NODE_ENV === "production",
): void {
  if (!isProduction) return;

  const contracts = new Set(PRODUCTION_RESPONSE_PARSER_ROUTES.map((route) => route.contract));
  if (contracts.size !== 1 || !contracts.has(CANONICAL_MODEL_RESPONSE_CONTRACT)) {
    throw new Error("MODEL_RESPONSE_CONTRACT_MISMATCH");
  }

  if (!env.conversationDecisionV2Enabled) {
    throw new Error("MODEL_RESPONSE_CONTRACT_GUARD_FAILED: conversation_decision_v2_disabled");
  }
  if (!env.modelAdapterLayerEnabled || !env.openaiResponsesModel) {
    throw new Error("MODEL_RESPONSE_CONTRACT_GUARD_FAILED: responses_v3_runtime_not_global");
  }
  if (env.behaviorOrchestratorEnabled) {
    throw new Error("MODEL_RESPONSE_CONTRACT_GUARD_FAILED: behavior_v1_contract_enabled");
  }
}
