import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv } from "../../config/env.js";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function withEnv<T>(patch: Record<string, string | undefined>, run: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, process.env[key]);
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

describe("Package 07 reconciliation seal", () => {
  it("aligns package status documents without claiming production deployment", () => {
    expect(source("docs/architecture/PACKAGE_04_CANONICAL_MODEL_ADAPTER_CONTRACT.md"))
      .toContain("ACCEPTED CANDIDATE / NOT DEPLOYED / PRODUCTION UNCHANGED");
    expect(source("docs/architecture/PACKAGE_04B_MIGRATION_READINESS_HARDENING.md"))
      .toContain("ACCEPTED CANDIDATE / NOT DEPLOYED / PRODUCTION UNCHANGED");
    expect(source("docs/architecture/PACKAGE_05_RESPONSES_SHADOW_INTEGRATION.md"))
      .toContain("PASS / IMMUTABLE CANDIDATE READY / PRODUCTION NOT DEPLOYED");
    expect(source("docs/architecture/PACKAGE_06_GOLDEN_REPLAY_QUALITY_MEASUREMENT.md"))
      .toContain("COMPLETE WITH QUALITY GATE BLOCKED / PRODUCTION UNCHANGED");
  });

  it("keeps the Package 06 quality failure explicit", () => {
    const reconciliation = source("docs/architecture/PACKAGE_07_CROSS_PACKAGE_RECONCILIATION.md");

    expect(reconciliation).toContain("Package 6 quality failure remains blocking");
    expect(reconciliation).toContain("Current Assistant remains the canonical production and rollback path");
    expect(reconciliation).not.toMatch(/Responses quality gate: PASS|Responses production cutover approved/i);
  });

  it("does not carry generated Package 05 test artifacts into the candidate source", () => {
    expect(existsSync(join(process.cwd(), "package05-vitest.log"))).toBe(false);
    expect(existsSync(join(process.cwd(), "package05-vitest-results.json"))).toBe(false);
  });

  it("keeps Responses shadow and all cutover controls default-off", () => {
    const env = withEnv({
      PORT: "3000",
      EVOLUTION_API_BASE_URL: "http://evolution.invalid",
      EVOLUTION_INSTANCE: "fixture_instance",
      EVOLUTION_API_KEY: "fixture_key",
      OPENAI_API_KEY: "fixture_key",
      OPENAI_ASSISTANT_ID: "fixture_assistant",
      OWNER_PHONE_NUMBERS: "",
      MANAGER_PHONE_NUMBERS: "",
      SYSTEM_PROMPT_VERSION: "1.0",
      KNOWLEDGE_BASE_VERSION: "1.0",
      BACKEND_CONTEXT_VERSION: "1.0",
      STATE_MACHINE_VERSION: "1.0",
      ASSISTANT_RESPONSE_CONTRACT_VERSION: "1.0",
      RESPONSES_SHADOW_ENABLED: undefined,
      RESPONSES_SHADOW_MODE: undefined,
      MODEL_ADAPTER_LAYER_ENABLED: undefined,
      FAST_ACK_ENABLED: undefined,
      WORKERS_ENABLED: undefined,
    }, () => loadEnv());

    expect(env.responsesShadowEnabled).toBe(false);
    expect(env.responsesShadowMode).toBe("off");
    expect(env.modelAdapterLayerEnabled).toBe(false);
    expect(env.fastAckEnabled).toBe(false);
    expect(env.workersEnabled).toBe(false);
  });

  it("keeps one provider-neutral adapter interface and no primary Responses selection", () => {
    const adapterContract = source("src/modelAdapter/IModelAdapter.ts");
    const factory = source("src/modelAdapter/modelAdapterFactory.ts");
    const execution = source("src/modelAdapter/modelExecutionService.ts");

    expect(adapterContract).toContain("run(input: ModelAdapterInput)");
    expect(adapterContract).not.toContain("execute(request:");
    expect(factory).toContain("return new AssistantAdapter");
    expect(factory).not.toContain("ResponsesAdapter");
    expect(execution).toContain("adapter.run(input)");
    expect(execution).not.toContain("runAssistantWithBackendContext");
  });
});
