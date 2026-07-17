import { describe, it, expect, vi, beforeEach } from "vitest";
import { ModelExecutionService, type ModelExecutionOptions } from "../../modelAdapter/modelExecutionService.js";
import { ModelExecutionError } from "../../modelAdapter/modelExecutionErrors.js";
import type { IModelAdapter } from "../../modelAdapter/IModelAdapter.js";
import type { AssistantClient } from "../../assistant/openaiAssistantClient.js";
import type { ThreadStore } from "../../storage/threadStore.js";
import type { ModelAdapterInput } from "../../modelAdapter/types.js";

class HangingAdapter implements IModelAdapter {
  readonly name = "HangingAdapter";
  readonly provider = "test";
  async health() { return { ok: true, provider: "test", supportsResponseContractVersion: "1.0" as const }; }
  getIdentity() { return { adapter_name: "HangingAdapter", provider: "test", model: "test" }; }
  async run(_input: ModelAdapterInput): Promise<never> {
    return new Promise((_resolve) => setTimeout(() => undefined, 100000));
  }
}

class ErrorAdapter implements IModelAdapter {
  readonly name = "ErrorAdapter";
  readonly provider = "test";
  constructor(private readonly err: Error) {}
  async health() { return { ok: true, provider: "test", supportsResponseContractVersion: "1.0" as const }; }
  getIdentity() { return { adapter_name: "ErrorAdapter", provider: "test", model: "test" }; }
  async run(_input: ModelAdapterInput): Promise<never> {
    throw this.err;
  }
}

describe("Model Execution Resilience", () => {
  const dummyInput = {
    tenantId: "test",
    conversationId: "conv1",
    senderRole: "owner",
    channelType: "private",
    mode: "mixed_research",
    metadata: {
      featureFlags: {
        behavior_orchestrator_enabled: false,
        model_adapter_layer_enabled: true,
        model_adapter_canary_mode: "off",
        model_adapter_canary_tenants: [],
        model_adapter_canary_roles: []
      },
      traceId: "trace1"
    },
    contextPayload: {} as any,
    responseContractVersion: "1.0",
  };

  it("times out execution if adapter hangs", async () => {
    const service = new ModelExecutionService(
      {} as AssistantClient,
      {} as ThreadStore,
      {
        modelAdapterLayerEnabled: true,
        modelAdapterCanaryMode: "off",
        adapterFactory: () => new HangingAdapter()
      }
    );

    await expect(service.execute(dummyInput as any, { timeoutEnabled: true, timeoutMs: 100 })).rejects.toThrow(ModelExecutionError);
    const snapshot = service.snapshot();
    expect(snapshot.model_execution_last_error_code).toBe("TIMEOUT");
  });

  it("handles standard adapter errors gracefully", async () => {
    const service = new ModelExecutionService(
      {} as AssistantClient,
      {} as ThreadStore,
      {
        modelAdapterLayerEnabled: true,
        modelAdapterCanaryMode: "off",
        adapterFactory: () => new ErrorAdapter(new Error("Test error"))
      }
    );

    await expect(service.execute(dummyInput as any)).rejects.toThrow(ModelExecutionError);
    const snapshot = service.snapshot();
    expect(snapshot.model_adapter_last_error_class).toBe("model_execution_error");
  });

  it("respects external abort signals", async () => {
    const service = new ModelExecutionService(
      {} as AssistantClient,
      {} as ThreadStore,
      {
        modelAdapterLayerEnabled: true,
        modelAdapterCanaryMode: "off",
        adapterFactory: () => new HangingAdapter()
      }
    );

    const controller = new AbortController();
    const executePromise = service.execute(dummyInput as any, { signal: controller.signal });
    controller.abort();

    await expect(executePromise).rejects.toThrow(ModelExecutionError);
    const snapshot = service.snapshot();
    expect(snapshot.model_execution_last_error_code).toBe("CANCELLED");
  });
});
