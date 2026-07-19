import { describe, expect, it } from "vitest";
import { loadEnv } from "../config/env.js";

function withEnv<T>(patch: Record<string, string | undefined>, run: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(patch)) {
    previous.set(key, process.env[key]);
    const value = patch[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const requiredEnv = {
  PORT: "3000",
  EVOLUTION_API_BASE_URL: "http://evolution.local",
  EVOLUTION_INSTANCE: "nowakademi_bot",
  EVOLUTION_API_KEY: "test",
  OPENAI_API_KEY: "test",
  OPENAI_ASSISTANT_ID: "asst_test",
  OWNER_PHONE_NUMBERS: "905111111111",
  MANAGER_PHONE_NUMBERS: "",
  SYSTEM_PROMPT_VERSION: "1.0.0",
  KNOWLEDGE_BASE_VERSION: "2026.07.04",
  BACKEND_CONTEXT_VERSION: "1.0",
  STATE_MACHINE_VERSION: "1.0",
  ASSISTANT_RESPONSE_CONTRACT_VERSION: "1.0",
};

describe("model execution timeout env", () => {
  it("keeps timeout disabled by default with a safe configured fallback", () => {
    const env = withEnv({
      ...requiredEnv,
      MODEL_EXECUTION_TIMEOUT_ENABLED: undefined,
      MODEL_EXECUTION_TIMEOUT_MS: undefined,
    }, () => loadEnv());

    expect(env.modelExecutionTimeoutEnabled).toBe(false);
    expect(env.modelExecutionTimeoutMs).toBe(45_000);
  });

  it("uses explicit timeout settings without enabling them accidentally", () => {
    const env = withEnv({
      ...requiredEnv,
      MODEL_EXECUTION_TIMEOUT_ENABLED: "true",
      MODEL_EXECUTION_TIMEOUT_MS: "12000",
    }, () => loadEnv());

    expect(env.modelExecutionTimeoutEnabled).toBe(true);
    expect(env.modelExecutionTimeoutMs).toBe(12_000);
  });

  it("falls back safely when timeout milliseconds are invalid", () => {
    const env = withEnv({
      ...requiredEnv,
      MODEL_EXECUTION_TIMEOUT_ENABLED: "true",
      MODEL_EXECUTION_TIMEOUT_MS: "-1",
    }, () => loadEnv());

    expect(env.modelExecutionTimeoutEnabled).toBe(true);
    expect(env.modelExecutionTimeoutMs).toBe(45_000);
  });
});

describe("Responses shadow env", () => {
  it("keeps missing-policy normalization disabled unless explicitly enabled", () => {
    const disabled = withEnv({
      ...requiredEnv,
      RESPONSES_MISSING_POLICY_NORMALIZATION_ENABLED: undefined,
    }, () => loadEnv());
    const enabled = withEnv({
      ...requiredEnv,
      RESPONSES_MISSING_POLICY_NORMALIZATION_ENABLED: "true",
    }, () => loadEnv());

    expect(disabled.responsesMissingPolicyNormalizationEnabled).toBe(false);
    expect(enabled.responsesMissingPolicyNormalizationEnabled).toBe(true);
  });

  it("is fully disabled by default", () => {
    const env = withEnv({
      ...requiredEnv,
      RESPONSES_SHADOW_ENABLED: undefined,
      RESPONSES_SHADOW_MODE: undefined,
      RESPONSES_SHADOW_TENANTS: undefined,
      RESPONSES_SHADOW_ROLES: undefined,
      OPENAI_RESPONSES_MODEL: undefined,
    }, () => loadEnv());

    expect(env.responsesShadowEnabled).toBe(false);
    expect(env.responsesShadowMode).toBe("off");
    expect(env.responsesShadowTenants).toEqual([]);
    expect(env.responsesShadowRoles).toEqual([]);
    expect(env.openaiResponsesModel).toBeUndefined();
  });

  it("loads an explicit scoped shadow configuration without changing primary adapter flags", () => {
    const env = withEnv({
      ...requiredEnv,
      RESPONSES_SHADOW_ENABLED: "true",
      RESPONSES_SHADOW_MODE: "tenant_allowlist",
      RESPONSES_SHADOW_TENANTS: "tenant_a",
      RESPONSES_SHADOW_ROLES: "candidate",
      RESPONSES_SHADOW_TIMEOUT_MS: "8000",
      OPENAI_RESPONSES_MODEL: "responses-model-fixture",
      MODEL_ADAPTER_LAYER_ENABLED: undefined,
    }, () => loadEnv());

    expect(env).toMatchObject({
      responsesShadowEnabled: true,
      responsesShadowMode: "tenant_allowlist",
      responsesShadowTenants: ["tenant_a"],
      responsesShadowRoles: ["candidate"],
      responsesShadowTimeoutMs: 8000,
      openaiResponsesModel: "responses-model-fixture",
      modelAdapterLayerEnabled: false,
    });
  });

  it("fails closed to mode off for an invalid shadow mode", () => {
    const env = withEnv({
      ...requiredEnv,
      RESPONSES_SHADOW_ENABLED: "true",
      RESPONSES_SHADOW_MODE: "global",
    }, () => loadEnv());

    expect(env.responsesShadowMode).toBe("off");
  });
});
