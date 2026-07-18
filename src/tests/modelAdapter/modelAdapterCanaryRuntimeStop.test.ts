import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleIncomingMessage } from "../../bridge/handleIncomingMessage.js";
import type { NormalizedIncomingMessage } from "../../bridge/normalizeEvolutionMessage.js";
import type { IModelAdapter } from "../../modelAdapter/IModelAdapter.js";
import { ModelAdapterCanaryApprovalStore } from "../../modelAdapter/modelAdapterCanaryApproval.js";
import { ModelAdapterCanaryControl } from "../../modelAdapter/modelAdapterCanaryControl.js";
import { ModelAdapterCanaryThresholdEvaluator } from "../../modelAdapter/modelAdapterCanaryThresholds.js";
import { ModelExecutionService } from "../../modelAdapter/modelExecutionService.js";
import type { ModelAdapterInput, ModelAdapterOutput } from "../../modelAdapter/types.js";
import { UserRunLock } from "../../queue/userRunLock.js";
import { InMemoryMessageDedupeStore } from "../../storage/messageDedupeStore.js";
import { InMemoryStore } from "../../storage/memoryStore.js";
import { InMemoryThreadStore } from "../../storage/threadStore.js";
import {
  createSilentLogger,
  createTestEnv,
  FakeAssistantClient,
  FakeSender,
  InMemoryUserStateStore,
} from "../testDoubles.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function decision(reply: string): string {
  return JSON.stringify({
    decision_version: "2.0",
    intent: { primary: "handle_trust_objection", secondary: [], confidence: 0.95 },
    direct_question: { present: true, question_summary: "Aday guven konusunda tereddut ediyor", answered_in_reply: true },
    reply: { text: reply, language: "tr", tone: "natural_concise", contains_question: false },
    chosen_actions: ["answer_user_question", "handle_objection"],
    state_patch: {},
    policy_facts_used: [],
    next_action: "answer_user_question",
    requires_escalation: false,
    escalation_reason: null,
    risk_flags: [],
    self_check: {
      answered_latest_message: true,
      asked_known_information_again: false,
      invented_policy: false,
      offered_setup_too_early: false,
      used_generic_closing: false,
    },
  });
}

class SequenceAdapter implements IModelAdapter {
  readonly name = "assistant_adapter";
  readonly provider = "openai_assistant";

  constructor(private readonly outputs: string[]) {}

  async run(_input: ModelAdapterInput): Promise<ModelAdapterOutput> {
    const rawText = this.outputs.shift() ?? decision("Sorularini acikca yanitlayabiliriz; karar vermek icin acele etmene gerek yok.");
    return {
      rawText,
      normalizedResponse: { reply: "adapter-contract-ok", internal_boss_note: "" },
      rawProviderResponseStored: false,
      providerTrace: {
        provider: this.provider,
        adapter: this.name,
        response_contract_version: "1.0",
      },
    };
  }

  async health() {
    return { ok: true, provider: this.provider, supportsResponseContractVersion: "1.0" as const };
  }

  getIdentity() {
    return { adapter_name: this.name, provider: this.provider, model: "synthetic-runtime-fixture" };
  }
}

function candidateMessage(): NormalizedIncomingMessage {
  return {
    correlation_id: "canary-runtime-unsafe-event",
    sender_id: "synthetic-candidate",
    phone_number: "5550000000",
    remote_jid: "private-safe-reference",
    message_id: "canary-runtime-message",
    message_type: "conversation",
    text: "Aday guvenemiyor, nasil ilerleyelim?",
    chat_type: "private",
    is_from_me: false,
    is_group: false,
    received_at: "2026-07-18T12:00:00.000Z",
  };
}

function approvalStore(now: Date) {
  const directory = mkdtempSync(join(tmpdir(), "now-os-canary-stop-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "approval.json");
  const store = new ModelAdapterCanaryApprovalStore(path);
  store.write({
    schema_version: 1,
    approval_id: "synthetic-no-outbound-approval",
    approval_generation: "synthetic-no-outbound-generation",
    approved: true,
    issued_by: "owner_dashboard_token",
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 15 * 60_000).toISOString(),
    maximum_observed_messages: 1,
    scope: {
      tenant_id: "now_os",
      intents: ["candidate_first_contact"],
      traffic_percent: 10,
      channel: "private",
      sender_role: "candidate",
    },
    invalidated_at: null,
    invalidation_reason: null,
  });
  return { path, store };
}

describe("model adapter canary runtime automatic stop", () => {
  it("invalidates persistent approval and latches mode off on unsafe_claim_count", () => {
    const now = new Date("2026-07-18T12:00:00.000Z");
    const logger = createSilentLogger();
    const approval = approvalStore(now);
    const control = new ModelAdapterCanaryControl(
      approval.store,
      new ModelAdapterCanaryThresholdEvaluator(),
      logger,
      () => now,
    );

    expect(control.reserve("event-one")).toBe("reserved");
    const result = control.finalize("event-one", {
      unsafe_claim_count: 1,
      internal_or_raw_output_outbound_count: 0,
      sensitive_log_count: 0,
      unauthorized_path_count: 0,
      outbound_count_mismatch_count: 0,
      hash_mismatch_count: 0,
      invalid_transition_applied_count: 0,
      fake_link_promoted_count: 0,
      safe_fallback_count: 0,
      validator_reject_count: 1,
      schema_or_parse_reject_count: 0,
      final_provider_failure_count: 0,
      terminal_failure_count: 0,
      model_origin_accepted_count: 0,
      transient_retry_count: 0,
      timeout_before_retry_count: 0,
      latency_ms: 10,
    });

    expect(result).toMatchObject({
      status: "finalized",
      egress_allowed: false,
      stop_triggered: true,
      effective_canary_mode: "off",
      threshold_ids: ["unsafe_claim_count"],
    });
    expect(control.effectiveMode("internal")).toBe("off");
    expect(approval.store.isValid(now)).toBe(false);
    expect(control.reserve("event-two")).toBe("denied_stop_latched");
    expect(control.finalize("event-one", {
      unsafe_claim_count: 1,
      internal_or_raw_output_outbound_count: 0,
      sensitive_log_count: 0,
      unauthorized_path_count: 0,
      outbound_count_mismatch_count: 0,
      hash_mismatch_count: 0,
      invalid_transition_applied_count: 0,
      fake_link_promoted_count: 0,
      safe_fallback_count: 0,
      validator_reject_count: 1,
      schema_or_parse_reject_count: 0,
      final_provider_failure_count: 0,
      terminal_failure_count: 0,
      model_origin_accepted_count: 0,
      transient_retry_count: 0,
      timeout_before_retry_count: 0,
      latency_ms: 10,
    }).status).toBe("already_finalized");
    expect(control.snapshot().terminal_observation_count).toBe(1);
    expect(JSON.parse(readFileSync(approval.path, "utf8"))).toMatchObject({
      approved: false,
      invalidation_reason: "unsafe_claim_count",
    });
    expect(logger.events).toContainEqual(expect.objectContaining({
      event_type: "MODEL_ADAPTER_CANARY_AUTOMATIC_STOP",
      effective_canary_mode: "off",
      approval_invalidated: true,
      egress_allowed: false,
      raw_text_logged: false,
    }));
    expect(logger.events.filter((event) => event.event_type === "MODEL_ADAPTER_CANARY_AUTOMATIC_STOP")).toHaveLength(1);

    const restartedControl = new ModelAdapterCanaryControl(
      approval.store,
      new ModelAdapterCanaryThresholdEvaluator(),
      logger,
      () => now,
    );
    expect(restartedControl.snapshot()).toMatchObject({
      stop_latched: true,
      stop_reason: "unsafe_claim_count",
      approval_valid: false,
    });
    expect(restartedControl.effectiveMode("internal")).toBe("off");
  });

  it("runs in the canonical candidate event path and blocks unsafe reply before outbound", async () => {
    const now = new Date("2026-07-18T12:00:00.000Z");
    const logger = createSilentLogger();
    const approval = approvalStore(now);
    const control = new ModelAdapterCanaryControl(
      approval.store,
      new ModelAdapterCanaryThresholdEvaluator(),
      logger,
      () => now,
    );
    const assistantClient = new FakeAssistantClient();
    const threadStore = new InMemoryThreadStore();
    const unsafeDraft = decision("Dilersen daha once baslayanlardan referans paylasabilirim.");
    const safeRepair = decision("Süreci adim adim inceleyebilir, aklina takilanlari rahatça sorabilirsin.");
    const adapter = new SequenceAdapter([unsafeDraft, safeRepair]);
    const modelExecutionService = new ModelExecutionService(assistantClient, threadStore, {
      modelAdapterLayerEnabled: false,
      modelAdapterCanaryMode: "internal",
      canaryControl: control,
      adapterFactory: () => adapter,
    });
    const sender = new FakeSender();
    const result = await handleIncomingMessage(candidateMessage(), {
      env: createTestEnv({
        conversationDecisionV2Enabled: true,
        modelAdapterLayerEnabled: false,
        modelAdapterCanaryMode: "internal",
        modelAdapterCanaryRoles: ["candidate"],
        approvedApps: ["Layla", "Linky"],
      }),
      modelExecutionService,
      assistantClient,
      sender,
      threadStore,
      memoryStore: new InMemoryStore(),
      messageDedupeStore: new InMemoryMessageDedupeStore(),
      userStateStore: new InMemoryUserStateStore(),
      userRunLock: new UserRunLock(),
      logger,
    });

    expect(result.status, JSON.stringify(logger.events, null, 2)).toBe("canary_stopped");
    expect(sender.sends).toHaveLength(0);
    expect(modelExecutionService.snapshot()).toMatchObject({
      model_adapter_canary_mode: "off",
      model_adapter_canary_mode_configured: "internal",
      automatic_stop_code_active: true,
      canary_stop_latched: true,
      canary_stop_reason: "unsafe_claim_count",
      canary_approval_valid: false,
      canary_reservation_count: 1,
      canary_terminal_observation_count: 1,
    });
    expect(logger.events).toContainEqual(expect.objectContaining({
      event_type: "MODEL_ADAPTER_CANARY_EGRESS_BLOCKED",
      threshold_ids: ["unsafe_claim_count"],
      effective_canary_mode: "off",
      outbound_count: 0,
      raw_text_logged: false,
    }));
    expect(JSON.stringify(logger.events)).not.toContain(candidateMessage().text);
  });
});
