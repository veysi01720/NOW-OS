import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleIncomingMessage } from "../../bridge/handleIncomingMessage.js";
import type { NormalizedIncomingMessage } from "../../bridge/normalizeEvolutionMessage.js";
import { inferConversationIntent } from "../../intelligence/conversation/ConversationContextBuilder.js";
import type { IModelAdapter } from "../../modelAdapter/IModelAdapter.js";
import { ModelAdapterCanaryApprovalStore } from "../../modelAdapter/modelAdapterCanaryApproval.js";
import { ModelAdapterCanaryControl } from "../../modelAdapter/modelAdapterCanaryControl.js";
import { ModelAdapterCanaryThresholdEvaluator } from "../../modelAdapter/modelAdapterCanaryThresholds.js";
import { resolveModelAdapterExecution } from "../../modelAdapter/modelAdapterSelection.js";
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

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function v3Greeting(): string {
  return JSON.stringify({
    decision_version: "3.1",
    intent: { primary: "candidate_first_contact", secondary: [], confidence: 0.98 },
    role: "candidate",
    direct_question: { present: false, question_summary: null, answered_in_reply: true },
    reply: {
      text: "Merhaba, doğru yönlendirme için yaşını, cinsiyetini ve günlük kaç saat ayırabileceğini yazar mısın?",
      language: "tr",
      tone: "natural_concise",
      contains_question: true,
    },
    next_action: "ask_missing_info",
    chosen_actions: ["ask_missing_age", "ask_missing_gender", "ask_missing_daily_hours"],
    state_patch: {
      age: null,
      gender: null,
      daily_hours: null,
      work_model_acceptance: null,
      selected_app: null,
      phone_type: null,
      work_model_disclosed: null,
      preferred_work_mode: null,
      video_allowed: null,
    },
    state_patch_evidence: [],
    missing_fields: ["age", "gender", "daily_hours"],
    policy_facts_used: [],
    requires_escalation: false,
    escalation_reason: null,
    risk_flags: [],
    quality_signals: {
      answered_latest_message: true,
      used_relevant_state: true,
      did_not_repeat_known_info: true,
      asked_only_one_clear_question: true,
      reply_is_natural_turkish: true,
      no_generic_closer: true,
      no_invented_policy: true,
      correct_role_boundary: true,
    },
    self_check: {
      answered_latest_message: true,
      asked_known_information_again: false,
      invented_policy: false,
      offered_setup_too_early: false,
      used_generic_closing: false,
    },
  });
}

class FakeResponsesAdapter implements IModelAdapter {
  readonly name = "ResponsesAdapter";
  readonly provider = "openai_responses";
  public calls = 0;

  async run(_input: ModelAdapterInput): Promise<ModelAdapterOutput> {
    this.calls += 1;
    return {
      rawText: v3Greeting(),
      normalizedResponse: null,
      rawProviderResponseStored: false,
      providerTrace: {
        provider: this.provider,
        adapter: this.name,
        response_contract_version: "conversation_decision_v3",
      },
    };
  }

  async health() {
    return { ok: true, provider: this.provider, supportsResponseContractVersion: "1.0" as const };
  }

  getIdentity() {
    return { adapter_name: this.name, provider: this.provider, model: "configured-model-fixture" };
  }
}

class FailingResponsesAdapter extends FakeResponsesAdapter {
  override async run(_input: ModelAdapterInput): Promise<ModelAdapterOutput> {
    this.calls += 1;
    throw new Error("synthetic provider failure");
  }
}

function selection(overrides: Partial<Parameters<typeof resolveModelAdapterExecution>[0]> = {}) {
  return resolveModelAdapterExecution({
    tenantId: "now_os",
    senderRole: "candidate",
    channelType: "private",
    mode: "conversation_decision_v2",
    inferredIntent: "candidate_first_contact",
    trafficBucket: 5,
    traceId: "sanitized-trace",
    featureFlags: {
      model_adapter_layer_enabled: false,
      model_adapter_canary_mode: "tenant_allowlist",
      model_adapter_canary_tenants: ["now_os"],
      model_adapter_canary_roles: ["candidate"],
      model_adapter_canary_intents: ["greeting_or_first_contact", "candidate_first_contact"],
      model_adapter_canary_percent: 10,
    },
    ...overrides,
  });
}

function message(): NormalizedIncomingMessage {
  return {
    correlation_id: "package13-greeting-trace",
    sender_id: "synthetic-candidate",
    phone_number: "5550000000",
    remote_jid: "private-safe-reference",
    message_id: "package13-greeting-message",
    message_type: "conversation",
    text: "Selam, iş için yazdım",
    chat_type: "private",
    is_from_me: false,
    is_group: false,
    received_at: "2026-07-18T12:00:00.000Z",
  };
}

describe("Package 13 candidate first-contact canary", () => {
  it("enforces the role, channel, tenant, intent, and traffic intersection", () => {
    expect(selection().useAdapterLayer).toBe(true);
    expect(selection({ senderRole: "owner" }).reason).toBe("denied_not_allowed_scope");
    expect(selection({ channelType: "group" }).reason).toBe("denied_channel");
    expect(selection({ tenantId: "wrong-tenant" }).reason).toBe("denied_not_allowed_scope");
    expect(selection({ inferredIntent: "payment_question" }).reason).toBe("denied_intent");
    expect(selection({ inferredIntent: "approve_review" }).reason).toBe("denied_intent");
    expect(selection({ inferredIntent: "reject_review" }).reason).toBe("denied_intent");
    expect(selection({ inferredIntent: "app_fact_question" }).reason).toBe("denied_intent");
    expect(selection({ inferredIntent: null }).reason).toBe("denied_intent");
    expect(selection({ trafficBucket: 10 }).reason).toBe("denied_traffic_bucket");
  });

  it("keeps unknown-app missing-policy traffic outside the exact first-contact intent scope", () => {
    const greetingIntent = inferConversationIntent("Selam");
    const firstContactIntent = inferConversationIntent("Selam, is icin yazdim");
    const unknownAppIntent = inferConversationIntent("NovaChat kodunu verir misin?");

    expect(greetingIntent).toBe("greeting_or_first_contact");
    expect(firstContactIntent).toBe("candidate_first_contact");
    expect(unknownAppIntent).toBeNull();

    expect(selection({ inferredIntent: greetingIntent }).useAdapterLayer).toBe(true);
    expect(selection({ inferredIntent: firstContactIntent }).useAdapterLayer).toBe(true);
    expect(selection({ inferredIntent: unknownAppIntent }).reason).toBe("denied_intent");

    // The qualification fixture's explicit semantic label is excluded too.
    expect(selection({ inferredIntent: "app_fact_question" }).reason).toBe("denied_intent");
  });

  it("uses Responses only for an approved private greeting and keeps real outbound at zero", async () => {
    const now = new Date("2026-07-18T12:00:00.000Z");
    const directory = mkdtempSync(join(tmpdir(), "now-os-package13-"));
    directories.push(directory);
    const approvals = new ModelAdapterCanaryApprovalStore(join(directory, "approval.json"));
    approvals.write({
      schema_version: 1,
      approval_id: "package13-synthetic-approval",
      approval_generation: "package13-synthetic-generation",
      approved: true,
      issued_by: "owner_dashboard_token",
      issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 15 * 60_000).toISOString(),
      maximum_observed_messages: 1,
      scope: {
        tenant_id: "now_os",
        intents: ["greeting_or_first_contact", "candidate_first_contact"],
        traffic_percent: 100,
        channel: "private",
        sender_role: "candidate",
      },
      invalidated_at: null,
      invalidation_reason: null,
    });
    const logger = createSilentLogger();
    const control = new ModelAdapterCanaryControl(
      approvals,
      new ModelAdapterCanaryThresholdEvaluator(),
      logger,
      () => now,
    );
    const responses = new FakeResponsesAdapter();
    const assistantClient = new FakeAssistantClient();
    const threadStore = new InMemoryThreadStore();
    const service = new ModelExecutionService(assistantClient, threadStore, {
      modelAdapterLayerEnabled: false,
      modelAdapterCanaryMode: "tenant_allowlist",
      canaryControl: control,
      canaryAdapter: responses,
    });
    const outboundSpy = new FakeSender();

    const result = await handleIncomingMessage(message(), {
      env: createTestEnv({
        conversationDecisionV2Enabled: true,
        modelAdapterLayerEnabled: false,
        modelAdapterCanaryMode: "tenant_allowlist",
        modelAdapterCanaryTenants: ["now_os"],
        modelAdapterCanaryRoles: ["candidate"],
        modelAdapterCanaryIntents: ["greeting_or_first_contact", "candidate_first_contact"],
        modelAdapterCanaryPercent: 100,
      }),
      modelExecutionService: service,
      assistantClient,
      sender: outboundSpy,
      threadStore,
      memoryStore: new InMemoryStore(),
      messageDedupeStore: new InMemoryMessageDedupeStore(),
      userStateStore: new InMemoryUserStateStore(),
      userRunLock: new UserRunLock(),
      logger,
    });

    expect(result.status).toBe("sent");
    expect(responses.calls).toBe(1);
    expect(assistantClient.runCalls).toHaveLength(0);
    expect(outboundSpy.sends).toHaveLength(1);
    expect(service.snapshot()).toMatchObject({
      model_adapter_selected_adapter: "ResponsesAdapter",
      model_adapter_provider: "openai_responses",
      responses_api_used: true,
      canary_reservation_count: 1,
      canary_terminal_observation_count: 1,
      canary_stop_latched: false,
    });
    expect(logger.events).toContainEqual(expect.objectContaining({
      event_type: "MODEL_ADAPTER_CANARY_RESERVED",
      raw_text_logged: false,
    }));
  });

  it("does not silently switch to Assistants when the scoped Responses request fails", async () => {
    const now = new Date("2026-07-18T12:00:00.000Z");
    const directory = mkdtempSync(join(tmpdir(), "now-os-package13-failure-"));
    directories.push(directory);
    const approvals = new ModelAdapterCanaryApprovalStore(join(directory, "approval.json"));
    approvals.write({
      schema_version: 1,
      approval_id: "package13-failure-approval",
      approval_generation: "package13-failure-generation",
      approved: true,
      issued_by: "owner_dashboard_token",
      issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 15 * 60_000).toISOString(),
      maximum_observed_messages: 1,
      scope: {
        tenant_id: "now_os",
        intents: ["greeting_or_first_contact", "candidate_first_contact"],
        traffic_percent: 100,
        channel: "private",
        sender_role: "candidate",
      },
      invalidated_at: null,
      invalidation_reason: null,
    });
    const logger = createSilentLogger();
    const control = new ModelAdapterCanaryControl(
      approvals,
      new ModelAdapterCanaryThresholdEvaluator(),
      logger,
      () => now,
    );
    const responses = new FailingResponsesAdapter();
    const assistantClient = new FakeAssistantClient([
      '{"contract_version":"1.0","reply":"legacy must not run","internal_boss_note":""}',
    ]);
    const threadStore = new InMemoryThreadStore();
    const service = new ModelExecutionService(assistantClient, threadStore, {
      modelAdapterLayerEnabled: false,
      modelAdapterCanaryMode: "tenant_allowlist",
      canaryControl: control,
      canaryAdapter: responses,
    });
    const outboundSpy = new FakeSender();

    const result = await handleIncomingMessage(message(), {
      env: createTestEnv({
        conversationDecisionV2Enabled: true,
        modelAdapterCanaryMode: "tenant_allowlist",
        modelAdapterCanaryTenants: ["now_os"],
        modelAdapterCanaryRoles: ["candidate"],
        modelAdapterCanaryIntents: ["greeting_or_first_contact", "candidate_first_contact"],
        modelAdapterCanaryPercent: 100,
      }),
      modelExecutionService: service,
      assistantClient,
      sender: outboundSpy,
      threadStore,
      memoryStore: new InMemoryStore(),
      messageDedupeStore: new InMemoryMessageDedupeStore(),
      userStateStore: new InMemoryUserStateStore(),
      userRunLock: new UserRunLock(),
      logger,
    });

    expect(result.status).toBe("sent");
    expect(responses.calls).toBe(1);
    expect(assistantClient.runCalls).toHaveLength(0);
    expect(outboundSpy.sends).toHaveLength(1);
    expect(outboundSpy.sends[0]?.text).not.toContain("legacy must not run");
    expect(service.snapshot()).toMatchObject({
      model_adapter_provider: "openai_responses",
      responses_api_used: true,
      canary_reservation_count: 1,
      canary_terminal_observation_count: 1,
    });
  });
});
