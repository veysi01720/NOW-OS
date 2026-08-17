import { describe, expect, it } from "vitest";
import {
  assertSingleProductionModelResponseContract,
  CANONICAL_MODEL_RESPONSE_CONTRACT,
  PRODUCTION_RESPONSE_PARSER_ROUTES,
} from "../modelAdapter/modelResponseContractGuard.js";
import { createTestEnv } from "./testDoubles.js";

describe("model response contract startup guard", () => {
  it("keeps every production parser route on the same V3 contract", () => {
    expect(PRODUCTION_RESPONSE_PARSER_ROUTES).not.toHaveLength(0);
    expect(new Set(PRODUCTION_RESPONSE_PARSER_ROUTES.map((route) => route.contract))).toEqual(
      new Set([CANONICAL_MODEL_RESPONSE_CONTRACT]),
    );
  });

  it("passes only when production is globally routed through Responses V3", () => {
    const env = createTestEnv({
      behaviorOrchestratorEnabled: false,
      conversationDecisionV2Enabled: true,
      modelAdapterLayerEnabled: true,
      openaiResponsesModel: "gpt-4.1",
    });

    expect(() => assertSingleProductionModelResponseContract(env, true)).not.toThrow();
  });

  it("fails closed when any retired v1 contract path could be active", () => {
    const base = createTestEnv({
      behaviorOrchestratorEnabled: false,
      conversationDecisionV2Enabled: true,
      modelAdapterLayerEnabled: true,
      openaiResponsesModel: "gpt-4.1",
    });

    expect(() => assertSingleProductionModelResponseContract({
      ...base,
      conversationDecisionV2Enabled: false,
    }, true)).toThrow(/conversation_decision_v2_disabled/);
    expect(() => assertSingleProductionModelResponseContract({
      ...base,
      modelAdapterLayerEnabled: false,
    }, true)).toThrow(/responses_v3_runtime_not_global/);
    expect(() => assertSingleProductionModelResponseContract({
      ...base,
      behaviorOrchestratorEnabled: true,
    }, true)).toThrow(/behavior_v1_contract_enabled/);
  });
});
