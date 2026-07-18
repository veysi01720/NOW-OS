import type { AssistantClient } from "../assistant/openaiAssistantClient.js";
import type { ThreadStore } from "../storage/threadStore.js";
import { parseAssistantResponseV1 } from "../contracts/assistantResponseContract.js";
import { createModelAdapter } from "./modelAdapterFactory.js";
import type { IModelAdapter } from "./IModelAdapter.js";
import { ModelExecutionError, normalizeModelExecutionError, type ModelExecutionErrorCode } from "./modelExecutionErrors.js";
import { resolveModelAdapterExecution, type AdapterExecutionDecision } from "./modelAdapterSelection.js";
import type { ModelAdapterInput, ModelAdapterOutput } from "./types.js";
import type { ResponsesShadowObserver } from "./responsesShadowService.js";
import type { ModelAdapterCanaryControl } from "./modelAdapterCanaryControl.js";
import type { ModelAdapterCanaryTerminalObservation } from "./modelAdapterCanaryThresholds.js";
import { createHash } from "node:crypto";

export type ModelAdapterLastErrorClass = "none" | "model_execution_error";

export interface ModelExecutionOptions {
  timeoutEnabled?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ModelExecutionRuntimeSnapshot {
  model_adapter_layer_global_enabled: boolean;
  model_adapter_canary_mode: "off" | "internal" | "tenant_allowlist";
  model_adapter_canary_mode_configured: "off" | "internal" | "tenant_allowlist";
  model_adapter_canary_scope_supported: boolean;
  model_adapter_current_decision: {
    use_adapter_layer: boolean;
    reason: AdapterExecutionDecision["reason"];
    canary_scope: AdapterExecutionDecision["canaryScope"];
  };
  model_adapter_selected_adapter: string;
  model_adapter_provider: string;
  model_adapter_last_success_at: string | null;
  model_adapter_last_error_class: ModelAdapterLastErrorClass;
  model_execution_last_error_code: ModelExecutionErrorCode | "none";
  model_execution_timeout_supported: true;
  model_execution_timeout_enabled: boolean;
  model_execution_timeout_ms_configured: boolean;
  model_execution_cancellation_supported: true;
  model_execution_error_normalization: true;
  adapter_abort_propagation_supported: false;
  late_result_ignored: boolean;
  model_adapter_rollback_method: "FLAG_OFF";
  assistant_id_changed: false;
  provider_changed: boolean;
  responses_api_used: boolean;
  automatic_stop_code_active: boolean;
  canary_stop_latched: boolean;
  canary_stop_reason: string | null;
  canary_approval_valid: boolean;
  canary_reservation_count: number;
  canary_terminal_observation_count: number;
}

export type ModelExecutionServiceInput = ModelAdapterInput;

export class ModelExecutionService {
  private lastDecision: AdapterExecutionDecision = {
    useAdapterLayer: false,
    adapterName: "assistant_adapter",
    provider: "openai_assistant",
    reason: "disabled_global",
    canaryScope: "none",
  };
  private lastGlobalEnabled = false;
  private lastCanaryMode: "off" | "internal" | "tenant_allowlist" = "off";
  private lastConfiguredCanaryMode: "off" | "internal" | "tenant_allowlist" = "off";
  private lastSuccessAt: string | null = null;
  private lastErrorClass: ModelAdapterLastErrorClass = "none";
  private lastErrorCode: ModelExecutionErrorCode | "none" = "none";
  private lastTimeoutEnabled = false;
  private lastTimeoutConfigured = false;
  private lastLateResultIgnored = false;
  private executionSequence = 0;
  private lastResponsesApiUsed = false;
  private readonly adapterFactory: (input: {
    assistantClient: AssistantClient;
    threadStore: ThreadStore;
  }) => IModelAdapter;

  constructor(
    private readonly assistantClient: AssistantClient,
    private readonly threadStore: ThreadStore,
    initialFlags?: {
      modelAdapterLayerEnabled: boolean;
      modelAdapterCanaryMode: "off" | "internal" | "tenant_allowlist";
      modelExecutionTimeoutEnabled?: boolean;
      modelExecutionTimeoutMsConfigured?: boolean;
      adapterFactory?: (input: {
        assistantClient: AssistantClient;
        threadStore: ThreadStore;
      }) => IModelAdapter;
      responsesShadowObserver?: ResponsesShadowObserver;
      canaryControl?: ModelAdapterCanaryControl;
      canaryAdapter?: IModelAdapter;
    },
  ) {
    this.adapterFactory = initialFlags?.adapterFactory ?? createModelAdapter;
    this.responsesShadowObserver = initialFlags?.responsesShadowObserver;
    this.canaryControl = initialFlags?.canaryControl;
    this.canaryAdapter = initialFlags?.canaryAdapter;
    if (initialFlags) {
      this.lastGlobalEnabled = initialFlags.modelAdapterLayerEnabled;
      this.lastCanaryMode = initialFlags.modelAdapterCanaryMode;
      this.lastConfiguredCanaryMode = initialFlags.modelAdapterCanaryMode;
      this.lastTimeoutEnabled = initialFlags.modelExecutionTimeoutEnabled === true;
      this.lastTimeoutConfigured = initialFlags.modelExecutionTimeoutMsConfigured === true;
      this.lastDecision = {
        useAdapterLayer: initialFlags.modelAdapterLayerEnabled,
        adapterName: "assistant_adapter",
        provider: "openai_assistant",
        reason: initialFlags.modelAdapterLayerEnabled ? "enabled_global" : "disabled_mode_off",
        canaryScope: initialFlags.modelAdapterCanaryMode === "off" ? "off" : initialFlags.modelAdapterCanaryMode,
      };
    }
  }

  private readonly responsesShadowObserver?: ResponsesShadowObserver;
  private readonly canaryControl?: ModelAdapterCanaryControl;
  private readonly canaryAdapter?: IModelAdapter;

  finalizeCanaryObservation(
    traceId: string,
    observation: ModelAdapterCanaryTerminalObservation,
  ): ReturnType<ModelAdapterCanaryControl["finalize"]> | null {
    return this.canaryControl?.finalize(traceId, observation) ?? null;
  }

  async execute(input: ModelExecutionServiceInput, options: ModelExecutionOptions = {}): Promise<ModelAdapterOutput> {
    this.lastTimeoutEnabled = options.timeoutEnabled === true;
    this.lastTimeoutConfigured = Number.isInteger(options.timeoutMs) && Number(options.timeoutMs) > 0;
    this.lastLateResultIgnored = false;
    const executionId = ++this.executionSequence;
    const shouldUseDeadline = this.lastTimeoutEnabled && this.lastTimeoutConfigured;
    if (!shouldUseDeadline && !options.signal) {
      const output = await this.executeCore(input, executionId, undefined);
      this.observeResponsesShadow(input, output);
      return output;
    }

    const controller = shouldUseDeadline ? new AbortController() : undefined;
    const adapterSignal = controller?.signal ?? options.signal;
    const lifecycleInput: ModelExecutionServiceInput = adapterSignal
      ? { ...input, execution: { ...(input.execution ?? {}), signal: adapterSignal, timeoutMs: options.timeoutMs } }
      : input;
    const core = this.executeCore(lifecycleInput, executionId, adapterSignal);
    core.catch(() => {
      if (executionId === this.executionSequence) return;
      this.lastLateResultIgnored = true;
    });

    const output = await this.withLifecycleDeadline(core, {
      executionId,
      timeoutEnabled: shouldUseDeadline,
      timeoutMs: options.timeoutMs,
      controller,
      externalSignal: options.signal,
    });
    this.observeResponsesShadow(input, output);
    return output;
  }

  private observeResponsesShadow(input: ModelExecutionServiceInput, output: ModelAdapterOutput): void {
    try {
      this.responsesShadowObserver?.observe(input, output);
    } catch {
      // Shadow observation must never alter the canonical Assistant result.
    }
  }

  private async executeCore(
    input: ModelExecutionServiceInput,
    executionId: number,
    signal: AbortSignal | undefined,
  ): Promise<ModelAdapterOutput> {
    const configuredMode = input.metadata.featureFlags.model_adapter_canary_mode;
    const controlSnapshot = this.canaryControl?.snapshot();
    const effectiveMode = this.canaryControl?.effectiveMode(configuredMode) ?? configuredMode;
    let decision = resolveModelAdapterExecution({
      tenantId: input.tenantId,
      senderRole: input.senderRole,
      channelType: input.channelType,
      mode: input.mode,
      featureFlags: {
        ...input.metadata.featureFlags,
        model_adapter_canary_mode: effectiveMode,
        model_adapter_stop_latched: controlSnapshot?.stop_latched ?? false,
      },
      inferredIntent: input.metadata.inferredIntent,
      trafficBucket: Number.parseInt(createHash("sha256").update(input.metadata.traceId).digest("hex").slice(0, 8), 16) % 100,
      traceId: input.metadata.traceId,
    });
    if (
      decision.useAdapterLayer
      && (input.metadata.featureFlags.model_adapter_canary_intents?.length ?? 0) > 0
      && !this.canaryAdapter
    ) {
      decision = {
        useAdapterLayer: false,
        adapterName: "assistant_adapter",
        provider: "openai_assistant",
        reason: "denied_adapter_unavailable",
        canaryScope: "off",
      };
    }
    if (
      decision.useAdapterLayer
      && !input.metadata.featureFlags.model_adapter_layer_enabled
      && configuredMode !== "off"
      && this.canaryControl
    ) {
      const reservation = this.canaryControl.reserve(input.metadata.traceId);
      if (reservation !== "reserved" && reservation !== "already_reserved") {
        const reason: AdapterExecutionDecision["reason"] = reservation === "denied_stop_latched"
          ? "disabled_stop_latched"
          : reservation === "denied_budget_exhausted"
            ? "denied_budget_exhausted"
            : reservation === "duplicate"
              ? "denied_duplicate_event"
              : "denied_approval_invalid";
        decision = {
          useAdapterLayer: false,
          adapterName: "assistant_adapter",
          provider: "openai_assistant",
          reason,
          canaryScope: "off",
        };
      }
    }
    this.lastDecision = decision;
    this.lastGlobalEnabled = input.metadata.featureFlags.model_adapter_layer_enabled;
    this.lastConfiguredCanaryMode = configuredMode;
    this.lastCanaryMode = decision.reason === "disabled_stop_latched" ? "off" : effectiveMode;

    try {
      if (signal?.aborted) {
        throw new ModelExecutionError({
          code: "CANCELLED",
          retryable: false,
          safeMessage: "Model execution was cancelled.",
          causeCategory: "abort_signal",
        });
      }
      const adapter = decision.useAdapterLayer && this.canaryAdapter
        ? this.canaryAdapter
        : this.adapterFactory({
            assistantClient: this.assistantClient,
            threadStore: this.threadStore,
          });
      this.lastDecision = {
        ...decision,
        adapterName: adapter.name === "AssistantAdapter" ? "assistant_adapter" : adapter.name,
        provider: adapter.provider,
      };
      this.lastResponsesApiUsed = decision.useAdapterLayer && adapter.provider === "openai_responses";
      const output = await adapter.run(input);

      if (decision.useAdapterLayer) {
        if (adapter.provider === "openai_responses" && output.rawText.trim() !== "") {
          this.markSuccess(executionId);
        } else if (output.normalizedResponse === null) {
          this.markContractFailure(output.rawText, executionId);
        } else {
          this.markSuccess(executionId);
        }
        return output;
      }

      this.markSuccess(executionId);
      return {
        ...output,
        normalizedResponse: null,
        providerTrace: {
          provider: adapter.provider,
          adapter: "legacy_assistant_boundary",
          response_contract_version: input.responseContractVersion,
        },
      };
    } catch (error) {
      if (executionId !== this.executionSequence) {
        this.lastLateResultIgnored = true;
        const lateNormalized = normalizeModelExecutionError(error);
        throw error instanceof ModelExecutionError ? error : new ModelExecutionError(lateNormalized);
      }
      this.lastErrorClass = "model_execution_error";
      const normalized = normalizeModelExecutionError(error);
      this.lastErrorCode = normalized.code;
      throw error instanceof ModelExecutionError ? error : new ModelExecutionError(normalized);
    }
  }

  private async withLifecycleDeadline(
    core: Promise<ModelAdapterOutput>,
    input: {
      executionId: number;
      timeoutEnabled: boolean;
      timeoutMs?: number;
      controller?: AbortController;
      externalSignal?: AbortSignal;
    },
  ): Promise<ModelAdapterOutput> {
    let terminal = false;
    let timeout: NodeJS.Timeout | undefined;
    let onExternalAbort: (() => void) | undefined;

    const failOnce = (error: ModelExecutionError): never => {
      if (!terminal) {
        terminal = true;
        this.lastErrorClass = "model_execution_error";
        this.lastErrorCode = error.normalized.code;
        if (input.executionId === this.executionSequence) {
          this.lastLateResultIgnored = true;
          this.executionSequence += 1;
        }
        input.controller?.abort();
      }
      throw error;
    };

    const timeoutPromise = new Promise<ModelAdapterOutput>((_resolve, reject) => {
      if (!input.timeoutEnabled || !input.timeoutMs) return;
      timeout = setTimeout(() => {
        try {
          failOnce(new ModelExecutionError({
            code: "TIMEOUT",
            retryable: true,
            safeMessage: "Model execution timed out.",
            causeCategory: "deadline",
          }));
        } catch (error) {
          reject(error);
        }
      }, input.timeoutMs);
    });

    const abortPromise = new Promise<ModelAdapterOutput>((_resolve, reject) => {
      if (!input.externalSignal) return;
      onExternalAbort = () => {
        try {
          failOnce(new ModelExecutionError({
            code: "CANCELLED",
            retryable: false,
            safeMessage: "Model execution was cancelled.",
            causeCategory: "external_abort",
          }));
        } catch (error) {
          reject(error);
        }
      };
      if (input.externalSignal.aborted) {
        onExternalAbort();
      } else {
        input.externalSignal.addEventListener("abort", onExternalAbort, { once: true });
      }
    });

    try {
      return await Promise.race([core, timeoutPromise, abortPromise]);
    } catch (error) {
      const normalized = normalizeModelExecutionError(error);
      this.lastErrorClass = "model_execution_error";
      this.lastErrorCode = normalized.code;
      throw error instanceof ModelExecutionError ? error : new ModelExecutionError(normalized);
    } finally {
      terminal = true;
      if (timeout) clearTimeout(timeout);
      if (input.externalSignal && onExternalAbort) {
        input.externalSignal.removeEventListener("abort", onExternalAbort);
      }
    }
  }

  snapshot(): ModelExecutionRuntimeSnapshot {
    const canary = this.canaryControl?.snapshot();
    return {
      model_adapter_layer_global_enabled: this.lastGlobalEnabled,
      model_adapter_canary_mode: this.canaryControl?.effectiveMode(this.lastConfiguredCanaryMode) ?? this.lastCanaryMode,
      model_adapter_canary_mode_configured: this.lastConfiguredCanaryMode,
      model_adapter_canary_scope_supported: true,
      model_adapter_current_decision: {
        use_adapter_layer: this.lastDecision.useAdapterLayer,
        reason: this.lastDecision.reason,
        canary_scope: this.lastDecision.canaryScope,
      },
      model_adapter_selected_adapter: this.lastDecision.adapterName,
      model_adapter_provider: this.lastDecision.provider,
      model_adapter_last_success_at: this.lastSuccessAt,
      model_adapter_last_error_class: this.lastErrorClass,
      model_execution_last_error_code: this.lastErrorCode,
      model_execution_timeout_supported: true,
      model_execution_timeout_enabled: this.lastTimeoutEnabled,
      model_execution_timeout_ms_configured: this.lastTimeoutConfigured,
      model_execution_cancellation_supported: true,
      model_execution_error_normalization: true,
      adapter_abort_propagation_supported: false,
      late_result_ignored: this.lastLateResultIgnored,
      model_adapter_rollback_method: "FLAG_OFF",
      assistant_id_changed: false,
      provider_changed: this.lastResponsesApiUsed,
      responses_api_used: this.lastResponsesApiUsed,
      automatic_stop_code_active: canary?.automatic_stop_code_active ?? false,
      canary_stop_latched: canary?.stop_latched ?? false,
      canary_stop_reason: canary?.stop_reason ?? null,
      canary_approval_valid: canary?.approval_valid ?? false,
      canary_reservation_count: canary?.reservation_count ?? 0,
      canary_terminal_observation_count: canary?.terminal_observation_count ?? 0,
    };
  }

  private markSuccess(executionId: number): void {
    if (executionId !== this.executionSequence) {
      this.lastLateResultIgnored = true;
      return;
    }
    this.lastSuccessAt = new Date().toISOString();
    this.lastErrorClass = "none";
    this.lastErrorCode = "none";
  }

  private markContractFailure(rawText: string, executionId: number): void {
    if (executionId !== this.executionSequence) {
      this.lastLateResultIgnored = true;
      return;
    }
    const parsed = parseAssistantResponseV1(rawText);
    this.lastErrorClass = "model_execution_error";
    if (rawText.trim() === "") {
      this.lastErrorCode = "EMPTY_RESPONSE";
    } else if (!parsed.ok && (parsed.error.code === "INVALID_JSON" || parsed.error.code === "NOT_OBJECT" || parsed.error.code === "ARRAY_NOT_ALLOWED" || parsed.error.code === "CODE_FENCE_NOT_ALLOWED")) {
      this.lastErrorCode = "MALFORMED_RESPONSE";
    } else {
      this.lastErrorCode = "CONTRACT_VALIDATION_FAILED";
    }
  }
}
