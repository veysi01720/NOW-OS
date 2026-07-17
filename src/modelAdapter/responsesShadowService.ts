import { createHash } from "node:crypto";
import type { IModelAdapter } from "./IModelAdapter.js";
import type { ModelAdapterInput, ModelAdapterOutput } from "./types.js";
import {
  buildConversationDecisionV3SemanticContext,
  validateConversationDecisionV3Semantics,
} from "../intelligence/conversation/ConversationDecisionV3SemanticValidator.js";
import type { Logger } from "../observability/logger.js";

export type ResponsesShadowMode = "off" | "internal" | "tenant_allowlist";
export type ResponsesShadowStatus = "never_run" | "skipped" | "valid" | "invalid" | "provider_error" | "timeout";

export interface ResponsesShadowConfig {
  enabled: boolean;
  mode: ResponsesShadowMode;
  tenants: string[];
  roles: string[];
  timeoutMs: number;
}

export interface ResponsesShadowSnapshot {
  enabled: boolean;
  mode: ResponsesShadowMode;
  default_off: true;
  primary_path_unchanged: true;
  outbound_allowed: false;
  state_writes_allowed: false;
  last_status: ResponsesShadowStatus;
  last_reason: string;
  last_observed_at: string | null;
  last_schema_valid: boolean | null;
  last_semantic_valid: boolean | null;
  last_role_match: boolean | null;
  last_reply_present: boolean | null;
  last_latency_ms: number | null;
  observations_total: number;
  valid_total: number;
  invalid_total: number;
  provider_error_total: number;
  timeout_total: number;
}

export interface ResponsesShadowObserver {
  observe(input: ModelAdapterInput, primaryOutput: ModelAdapterOutput): void;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function eligibility(input: ModelAdapterInput, config: ResponsesShadowConfig): { allowed: boolean; reason: string } {
  if (!config.enabled) return { allowed: false, reason: "disabled_global" };
  if (config.mode === "off") return { allowed: false, reason: "disabled_mode_off" };
  if (input.channelType !== "private") return { allowed: false, reason: "denied_non_private" };
  if (!config.roles.includes(input.senderRole)) return { allowed: false, reason: "denied_role" };
  if (config.mode === "tenant_allowlist" && !config.tenants.includes(input.tenantId)) {
    return { allowed: false, reason: config.tenants.length === 0 ? "denied_empty_tenant_allowlist" : "denied_tenant" };
  }
  return { allowed: true, reason: config.mode === "internal" ? "enabled_internal" : "enabled_tenant_allowlist" };
}

function sanitizeInput(input: ModelAdapterInput): ModelAdapterInput {
  return {
    ...input,
    conversationId: hash(input.conversationId),
    contextPayload: {
      ...input.contextPayload,
      correlation_id: hash(input.contextPayload.correlation_id),
      sender: { sender_id: "shadow_subject", phone_number: "shadow_subject" },
      chat: {
        ...input.contextPayload.chat,
        remote_jid: "shadow_private_ref",
        message_id: hash(input.contextPayload.chat.message_id),
      },
    },
    metadata: { ...input.metadata, traceId: hash(input.metadata.traceId) },
  };
}

function parseJson(rawText: string): { value?: unknown; parseError: boolean } {
  try {
    return { value: JSON.parse(rawText), parseError: false };
  } catch {
    return { parseError: true };
  }
}

export class ResponsesShadowService implements ResponsesShadowObserver {
  private pending = new Set<Promise<void>>();
  private state: ResponsesShadowSnapshot;

  constructor(
    private readonly adapter: IModelAdapter,
    private readonly config: ResponsesShadowConfig,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.state = {
      enabled: config.enabled,
      mode: config.mode,
      default_off: true,
      primary_path_unchanged: true,
      outbound_allowed: false,
      state_writes_allowed: false,
      last_status: "never_run",
      last_reason: config.enabled ? "not_observed" : "disabled_global",
      last_observed_at: null,
      last_schema_valid: null,
      last_semantic_valid: null,
      last_role_match: null,
      last_reply_present: null,
      last_latency_ms: null,
      observations_total: 0,
      valid_total: 0,
      invalid_total: 0,
      provider_error_total: 0,
      timeout_total: 0,
    };
  }

  observe(input: ModelAdapterInput, primaryOutput: ModelAdapterOutput): void {
    const decision = eligibility(input, this.config);
    if (!decision.allowed) {
      this.state = { ...this.state, last_status: "skipped", last_reason: decision.reason };
      return;
    }

    let task: Promise<void>;
    task = this.runObservation(input, primaryOutput)
      .catch(() => undefined)
      .finally(() => this.pending.delete(task));
    this.pending.add(task);
  }

  async drain(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  snapshot(): ResponsesShadowSnapshot {
    return { ...this.state };
  }

  private async runObservation(input: ModelAdapterInput, primaryOutput: ModelAdapterOutput): Promise<void> {
    const startedAt = Date.now();
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error("RESPONSES_SHADOW_TIMEOUT")), this.config.timeoutMs);
      timeoutHandle.unref?.();
    });

    try {
      const output = await Promise.race([this.adapter.run(sanitizeInput(input)), timeout]);
      const parsed = parseJson(output.rawText);
      const validation = parsed.parseError
        ? { ok: false, shape_valid: false, reason_codes: ["INVALID_JSON"] }
        : validateConversationDecisionV3Semantics(
          parsed.value,
          buildConversationDecisionV3SemanticContext(input),
        );
      const role = typeof parsed.value === "object" && parsed.value !== null
        ? (parsed.value as { role?: unknown }).role
        : undefined;
      const reply = typeof parsed.value === "object" && parsed.value !== null
        ? (parsed.value as { reply?: { text?: unknown } }).reply?.text
        : undefined;
      const roleMatch = role === input.senderRole;
      const replyPresent = typeof reply === "string" && reply.trim().length > 0;
      const valid = validation.ok && roleMatch && replyPresent;
      this.record(valid ? "valid" : "invalid", valid ? "validated" : validation.reason_codes[0] ?? (roleMatch ? "EMPTY_REPLY" : "ROLE_MISMATCH"), {
        schemaValid: validation.shape_valid,
        semanticValid: validation.shape_valid ? validation.ok : false,
        roleMatch,
        replyPresent,
        latencyMs: Date.now() - startedAt,
        primaryHash: hash(primaryOutput.rawText),
        shadowHash: hash(output.rawText),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.message === "RESPONSES_SHADOW_TIMEOUT";
      this.record(timedOut ? "timeout" : "provider_error", timedOut ? "deadline_exceeded" : "provider_failure", {
        schemaValid: null,
        semanticValid: null,
        roleMatch: null,
        replyPresent: null,
        latencyMs: Date.now() - startedAt,
        primaryHash: hash(primaryOutput.rawText),
        shadowHash: null,
      });
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  private record(
    status: Exclude<ResponsesShadowStatus, "never_run" | "skipped">,
    reason: string,
    details: {
      schemaValid: boolean | null;
      semanticValid: boolean | null;
      roleMatch: boolean | null;
      replyPresent: boolean | null;
      latencyMs: number;
      primaryHash: string;
      shadowHash: string | null;
    },
  ): void {
    const identity = this.adapter.getIdentity();
    this.state = {
      ...this.state,
      last_status: status,
      last_reason: reason,
      last_observed_at: this.now().toISOString(),
      last_schema_valid: details.schemaValid,
      last_semantic_valid: details.semanticValid,
      last_role_match: details.roleMatch,
      last_reply_present: details.replyPresent,
      last_latency_ms: details.latencyMs,
      observations_total: this.state.observations_total + 1,
      valid_total: this.state.valid_total + (status === "valid" ? 1 : 0),
      invalid_total: this.state.invalid_total + (status === "invalid" ? 1 : 0),
      provider_error_total: this.state.provider_error_total + (status === "provider_error" ? 1 : 0),
      timeout_total: this.state.timeout_total + (status === "timeout" ? 1 : 0),
    };
    this.logger.info({
      event_type: "RESPONSES_SHADOW_OBSERVATION",
      provider: identity.provider,
      adapter: identity.adapter_name,
      model: identity.model,
      status,
      reason,
      schema_valid: details.schemaValid,
      semantic_valid: details.semanticValid,
      role_match: details.roleMatch,
      reply_present: details.replyPresent,
      latency_ms: details.latencyMs,
      primary_output_hash: details.primaryHash,
      shadow_output_hash: details.shadowHash,
      raw_text_logged: false,
      outbound_count: 0,
      state_write_count: 0,
    });
  }
}
