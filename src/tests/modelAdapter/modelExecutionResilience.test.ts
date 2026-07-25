import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

describe("P0 temporary raw error diagnostic logging (MODEL_EXECUTION_RAW_ERROR_DIAGNOSTICS_ENABLED)", () => {
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
      traceId: "trace-diag-1"
    },
    contextPayload: {} as any,
    responseContractVersion: "1.0",
  };

  const originalFlag = process.env.MODEL_EXECUTION_RAW_ERROR_DIAGNOSTICS_ENABLED;

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.MODEL_EXECUTION_RAW_ERROR_DIAGNOSTICS_ENABLED;
    } else {
      process.env.MODEL_EXECUTION_RAW_ERROR_DIAGNOSTICS_ENABLED = originalFlag;
    }
  });

  it("does NOT log the diagnostic event when the flag is unset (default)", async () => {
    delete process.env.MODEL_EXECUTION_RAW_ERROR_DIAGNOSTICS_ENABLED;
    const warn = vi.fn();
    const service = new ModelExecutionService(
      {} as AssistantClient,
      {} as ThreadStore,
      {
        modelAdapterLayerEnabled: true,
        modelAdapterCanaryMode: "off",
        adapterFactory: () => new ErrorAdapter(new Error("do-not-log-this-message")),
        logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn(), fatal: vi.fn() },
      }
    );

    await expect(service.execute(dummyInput as any)).rejects.toThrow(ModelExecutionError);
    expect(warn).not.toHaveBeenCalled();
  });

  it("logs ONLY structural fields (never the raw message) when the flag is enabled", async () => {
    process.env.MODEL_EXECUTION_RAW_ERROR_DIAGNOSTICS_ENABLED = "true";
    const warn = vi.fn();
    const rawError = new Error("do-not-log-this-message") as Error & { status?: number; code?: string; type?: string };
    rawError.status = 503;
    rawError.code = "server_error";
    rawError.type = "api_error";
    const service = new ModelExecutionService(
      {} as AssistantClient,
      {} as ThreadStore,
      {
        modelAdapterLayerEnabled: true,
        modelAdapterCanaryMode: "off",
        adapterFactory: () => new ErrorAdapter(rawError),
        logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn(), fatal: vi.fn() },
      }
    );

    await expect(service.execute(dummyInput as any)).rejects.toThrow(ModelExecutionError);

    expect(warn).toHaveBeenCalledTimes(1);
    const loggedEvent = warn.mock.calls[0][0];
    expect(loggedEvent.event_type).toBe("P0_DIAG_RAW_MODEL_EXECUTION_ERROR");
    expect(loggedEvent.correlation_id).toBe("trace-diag-1");
    expect(loggedEvent.diag_http_status).toBe(503);
    expect(loggedEvent.diag_error_code).toBe("server_error");
    expect(loggedEvent.diag_error_category).toBe("api_error");
    expect(loggedEvent.diag_raw_message_logged).toBe(false);

    const serialized = JSON.stringify(loggedEvent);
    expect(serialized).not.toContain("do-not-log-this-message");
  });
});
