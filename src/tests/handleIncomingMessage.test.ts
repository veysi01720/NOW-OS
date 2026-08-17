import { handleIncomingMessage } from "../bridge/handleIncomingMessage.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SAFE_APPROVED_APP_GATE_REPLY } from "../bridge/approvedAppGuard.js";
import { ASSISTANT_SAFE_FALLBACK_REPLY } from "../contracts/assistantResponseContract.js";
import { UserRunLock } from "../queue/userRunLock.js";
import { InMemoryStore } from "../storage/memoryStore.js";
import { InMemoryMessageDedupeStore } from "../storage/messageDedupeStore.js";
import { InMemoryThreadStore } from "../storage/threadStore.js";
import { defaultUserState, type UserStateStore } from "../storage/types.js";
import type { NormalizedIncomingMessage } from "../bridge/normalizeEvolutionMessage.js";
import type { ModelExecutionService } from "../modelAdapter/modelExecutionService.js";
import type { ModelAdapterInput } from "../modelAdapter/types.js";
import {
  createSilentLogger,
  createTestEnv,
  FailingSender,
  FakeAssistantClient,
  FakeSender,
  InMemoryIngestionStore,
  InMemoryReportDataSource
} from "./testDoubles.js";
import { ZipIngestionStore } from "../bridge/zipIngestion/store.js";
import { writeValidKnowledgeBankFixture } from "./fixtures/knowledgeBankFixture.js";
import { PersistentHumanHandoffStore } from "../store/humanHandoffStore.js";
import { vi } from "vitest";

function message(overrides: Partial<NormalizedIncomingMessage> = {}): NormalizedIncomingMessage {
  return {
    correlation_id: "corr_test",
    sender_id: "905333333333",
    phone_number: "905333333333",
    remote_jid: "905333333333@s.whatsapp.net",
    message_id: "msg_test",
    message_type: "conversation",
    text: "Merhaba",
    chat_type: "private",
    is_from_me: false,
    is_group: false,
    received_at: "2026-07-04T00:00:00.000Z",
    ...overrides
  };
}

function deps(response: string) {
  return {
    env: createTestEnv(),
    assistantClient: new FakeAssistantClient([response]),
    sender: new FakeSender(),
    threadStore: new InMemoryThreadStore(),
    memoryStore: new InMemoryStore(),
    messageDedupeStore: new InMemoryMessageDedupeStore(),
    userRunLock: new UserRunLock(),
    logger: createSilentLogger()
  };
}

function conversationDecisionV3(input: {
  role: "candidate" | "owner" | "manager" | "group";
  reply?: string;
  nextAction?: "reply_only" | "ask_missing_info";
  chosenActions?: string[];
}) {
  return JSON.stringify({
    decision_version: "3.1",
    intent: { primary: "test_intent", secondary: [], confidence: 0.9 },
    role: input.role,
    direct_question: { present: false, question_summary: null, answered_in_reply: true },
    reply: {
      text: input.reply ?? "V3 ortak parser cevabi",
      language: "tr",
      tone: "natural_concise",
      contains_question: false,
    },
    next_action: input.nextAction ?? "reply_only",
    chosen_actions: input.chosenActions ?? ["answer_user_question"],
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
    missing_fields: [],
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

function v3ModelExecutionService(calls: ModelAdapterInput[] = []): ModelExecutionService {
  return {
    evaluateCanaryDecisionForMessage: () => ({
      useAdapterLayer: true,
      adapterName: "responses_adapter",
      provider: "openai_responses",
      reason: "enabled_global",
      canaryScope: "off",
    }),
    finalizeCanaryObservation: () => null,
    execute: async (input: ModelAdapterInput) => {
      calls.push(input);
      return {
        normalizedResponse: null,
        rawText: conversationDecisionV3({
          role: input.senderRole === "owner" || input.senderRole === "manager" ? input.senderRole : "candidate",
          reply: `${input.senderRole} V3 ortak parser cevabi`,
          nextAction: input.senderRole === "candidate" ? "ask_missing_info" : "reply_only",
          chosenActions: input.senderRole === "candidate"
            ? ["ask_missing_age", "ask_missing_gender", "ask_missing_daily_hours"]
            : ["answer_user_question"],
        }),
        providerTrace: {
          provider: "openai_responses",
          adapter: "responses_adapter",
          response_contract_version: "conversation_decision_v3",
        },
        rawProviderResponseStored: false as const,
      };
    },
  } as unknown as ModelExecutionService;
}

function selectedAppStateStore(selectedApp: string): UserStateStore {
  return {
    getOrCreateState: () => ({
      ...defaultUserState(),
      selected_app: selectedApp,
      missing_fields: ["phone_type"]
    }),
    updateState: () => undefined
  };
}

class MutableUserStateStore implements UserStateStore {
  public states = new Map<string, ReturnType<typeof defaultUserState>>();

  getOrCreateState(userId: string, defaults: ReturnType<typeof defaultUserState>): ReturnType<typeof defaultUserState> {
    const existing = this.states.get(userId);
    if (existing !== undefined) {
      return { ...existing, missing_fields: [...existing.missing_fields] };
    }

    const created = { ...defaults, missing_fields: [...defaults.missing_fields] };
    this.states.set(userId, created);
    return { ...created, missing_fields: [...created.missing_fields] };
  }

  updateState(userId: string, state: ReturnType<typeof defaultUserState>): void {
    this.states.set(userId, { ...state, missing_fields: [...state.missing_fields] });
  }
}

describe("handleIncomingMessage", () => {
  it("holds an unknown operational question, notifies both owners, and relays the owner answer", async () => {
    const handoffStore = new PersistentHumanHandoffStore(join(mkdtempSync(join(tmpdir(), "tmp-owner-answer-")), "handoffs.json"));
    const testDeps = { ...deps("{}"), humanHandoffStore: handoffStore };
    const candidate = await handleIncomingMessage(message({ text: "Kurulumda ajans kodu neden gerekli?", message_id: "unknown-operational" }), testDeps as any);

    expect(candidate.status).toBe("fallback_sent");
    expect(testDeps.sender.sends.map((item) => item.text)).toContain("Bunu hemen kontrol ediyorum; birkaç dakika içinde döneceğim.");
    expect(testDeps.sender.sends.some((item) => item.message.phone_number === "905111111111")).toBe(true);
    expect(testDeps.sender.sends.some((item) => item.message.phone_number === "905222222222")).toBe(true);
    expect(testDeps.sender.sends.find((item) => item.message.phone_number === "905111111111")?.text).toMatch(/^Arda,/u);
    expect(testDeps.sender.sends.find((item) => item.message.phone_number === "905222222222")?.text).not.toContain("Arda");
    expect(handoffStore.findPendingOwnerQuery()?.reason_code).toBe("owner_answer_required");

    const owner = await handleIncomingMessage(message({ phone_number: "905111111111", sender_id: "905111111111", text: "Kodsuz devam edebilirsin.", message_id: "owner-answer" }), testDeps as any);
    expect(owner.status).toBe("sent");
    expect(testDeps.sender.sends.at(-2)?.message.phone_number).toBe("905333333333");
    expect(testDeps.sender.sends.at(-2)?.text).toBe("Kodsuz devam edebilirsin.");
    expect(handoffStore.findPendingOwnerQuery()).toBeNull();
  });

  it("requires a candidate suffix when more than one owner query is pending", async () => {
    const handoffStore = new PersistentHumanHandoffStore(join(mkdtempSync(join(tmpdir(), "tmp-owner-multi-answer-")), "handoffs.json"));
    for (const [index, phone] of ["905333331234", "905333334444"].entries()) {
      handoffStore.createOwnerQuery({
        tenant_id: "now_os",
        conversation_key_hash: `candidate-${index}`,
        source_correlation_id: `pending-${index}`,
        candidate_phone: phone,
        question_sanitized: `Question ${index}`,
        failure_reason: "knowledge_missing",
      });
    }
    const testDeps = { ...deps("{}"), humanHandoffStore: handoffStore };

    await handleIncomingMessage(message({ phone_number: "905111111111", sender_id: "905111111111", text: "Kodsuz devam edebilir.", message_id: "ambiguous-owner-answer" }), testDeps as any);
    expect(testDeps.sender.sends.some((item) => item.message.phone_number === "905333331234" || item.message.phone_number === "905333334444")).toBe(false);
    expect(testDeps.sender.sends.at(-1)?.text).toContain("Birden fazla bekleyen aday");

    await handleIncomingMessage(message({ phone_number: "905111111111", sender_id: "905111111111", text: "cevap 4444 Kodsuz devam edebilirsin.", message_id: "targeted-owner-answer" }), testDeps as any);
    expect(testDeps.sender.sends.some((item) => item.message.phone_number === "905333334444" && item.text === "Kodsuz devam edebilirsin.")).toBe(true);
    expect(handoffStore.listPendingOwnerQueries()).toHaveLength(1);
  });

  it("routes an unanswered unknown operational question to the team after 15 minutes", async () => {
    vi.useFakeTimers();
    try {
      const handoffStore = new PersistentHumanHandoffStore(join(mkdtempSync(join(tmpdir(), "tmp-owner-timeout-")), "handoffs.json"));
      const testDeps = { ...deps("{}"), humanHandoffStore: handoffStore };
      await handleIncomingMessage(message({ text: "Kurulumda ajans kodu neden gerekli?", message_id: "unknown-timeout" }), testDeps as any);
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
      expect(testDeps.sender.sends.some((item) => item.message.phone_number === "905352265056")).toBe(true);
      expect(handoffStore.list().find((item) => item.reason_code === "owner_answer_required")?.owner_query?.team_escalated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not ask owners for security boundaries or off-topic chat", async () => {
    const paymentStore = new PersistentHumanHandoffStore(join(mkdtempSync(join(tmpdir(), "tmp-owner-payment-")), "handoffs.json"));
    const paymentDeps = { ...deps("{}"), humanHandoffStore: paymentStore };
    await handleIncomingMessage(message({ text: "Kesin kazanc garanti mi?", message_id: "payment-boundary" }), paymentDeps as any);
    expect(paymentStore.findPendingOwnerQuery()).toBeNull();

    const offTopicStore = new PersistentHumanHandoffStore(join(mkdtempSync(join(tmpdir(), "tmp-owner-offtopic-")), "handoffs.json"));
    const offTopicDeps = { ...deps("{}"), humanHandoffStore: offTopicStore };
    await handleIncomingMessage(message({ text: "Arda kim?", message_id: "off-topic" }), offTopicDeps as any);
    expect(offTopicStore.findPendingOwnerQuery()).toBeNull();
  });

  it("auto-approves and publishes a single #bilgi section after owner says evet", async () => {
    const root = mkdtempSync(join(process.cwd(), "tmp-owner-short-review-"));
    try {
      const bank = resolve(root, "knowledge_bank");
      writeValidKnowledgeBankFixture(bank, { includeTimo: true });
      const store = new ZipIngestionStore(resolve(root, "zip-store.json"));
      const testDeps = {
        ...deps("{}"),
        env: createTestEnv(),
        zipIngestionStore: store,
        knowledgeBankDir: bank,
      };
      await handleIncomingMessage(message({ phone_number: "905111111111", sender_id: "905111111111", text: "#bilgi Kurulumda takilan aday once uygulamayi kapatip acar.", message_id: "owner-info" }), testDeps);
      expect(testDeps.sender.sends[0]?.text).toContain("onay");
      await handleIncomingMessage(message({ phone_number: "905111111111", sender_id: "905111111111", text: "evet", message_id: "owner-yes" }), testDeps);
      expect(testDeps.sender.sends.at(-1)?.text).toContain("source_present=true");
      expect(readFileSync(resolve(bank, "app_facts.md"), "utf8")).toContain("Kurulumda takilan aday");
      expect(store.listLearningCandidates()[0]?.status).toBe("published");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a single #bilgi section after owner says hayir without changing active facts", async () => {
    const root = mkdtempSync(join(process.cwd(), "tmp-owner-short-reject-"));
    try {
      const bank = resolve(root, "knowledge_bank");
      writeValidKnowledgeBankFixture(bank, { includeTimo: true });
      const store = new ZipIngestionStore(resolve(root, "zip-store.json"));
      const before = readFileSync(resolve(bank, "app_facts.md"), "utf8");
      const testDeps = { ...deps("{}"), env: createTestEnv(), zipIngestionStore: store, knowledgeBankDir: bank };
      await handleIncomingMessage(message({ phone_number: "905111111111", sender_id: "905111111111", text: "#bilgi Gecici destek notu", message_id: "owner-info-no" }), testDeps);
      await handleIncomingMessage(message({ phone_number: "905111111111", sender_id: "905111111111", text: "hayir", message_id: "owner-no" }), testDeps);
      expect(testDeps.sender.sends.at(-1)?.text).toContain("reddedildi");
      expect(readFileSync(resolve(bank, "app_facts.md"), "utf8")).toBe(before);
      expect(store.listLearningCandidates()[0]?.status).toBe("rejected");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps multi-section #bilgi on the selectable review flow", async () => {
    const root = mkdtempSync(join(process.cwd(), "tmp-owner-multi-review-"));
    try {
      const bank = resolve(root, "knowledge_bank");
      writeValidKnowledgeBankFixture(bank, { includeTimo: true });
      const store = new ZipIngestionStore(resolve(root, "zip-store.json"));
      const before = readFileSync(resolve(bank, "app_facts.md"), "utf8");
      const testDeps = { ...deps("{}"), env: createTestEnv(), zipIngestionStore: store, knowledgeBankDir: bank };
      await handleIncomingMessage(message({ phone_number: "905111111111", sender_id: "905111111111", text: "#bilgi\n## Birinci\n\nBilgi bir.\n\n## Ikinci\n\nBilgi iki.", message_id: "owner-multi" }), testDeps);
      await handleIncomingMessage(message({ phone_number: "905111111111", sender_id: "905111111111", text: "evet", message_id: "owner-multi-yes" }), testDeps);
      expect(store.listLearningCandidates().filter((candidate) => candidate.status === "pending_owner_review")).toHaveLength(2);
      expect(readFileSync(resolve(bank, "app_facts.md"), "utf8")).toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("ignores fromMe messages", async () => {
    const testDeps = deps("{}");
    const result = await handleIncomingMessage(message({ is_from_me: true }), testDeps);

    expect(result.status).toBe("ignored_from_me");
    expect(testDeps.assistantClient.runCalls).toHaveLength(0);
    expect(testDeps.sender.sends).toHaveLength(0);
  });

  it("ignores empty messages", async () => {
    const testDeps = deps("{}");
    const result = await handleIncomingMessage(message({ text: "   " }), testDeps);

    expect(result.status).toBe("ignored_empty");
    expect(testDeps.assistantClient.runCalls).toHaveLength(0);
  });

  it("sends only reply for a valid Assistant response and logs internal_boss_note as metadata only", async () => {
    const testDeps = deps('{"contract_version":"1.0","reply":"Cevap","internal_boss_note":"sadece log"}');

    const result = await handleIncomingMessage(message(), testDeps);

    expect(result.status).toBe("sent");
    expect(testDeps.sender.sends).toHaveLength(1);
    expect(testDeps.sender.sends[0]?.text).toBe("Cevap");
    expect(testDeps.sender.sends[0]?.text).not.toContain("sadece log");
    expect(testDeps.logger.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "ASSISTANT_RESPONSE_VALID",
          message_id: "msg_test",
          conversation_id: "905***",
          sender: {
            sender_id: "905***",
            phone_number: "905***"
          },
          internal_boss_note_logged: true
        })
      ])
    );
    expect(JSON.stringify(testDeps.logger.events)).not.toContain("sadece log");
    expect(JSON.stringify(testDeps.logger.events)).not.toContain("905333333333");
    expect(testDeps.assistantClient.runCalls[0]?.content).toContain("<backend_context_json>");
    expect(testDeps.assistantClient.runCalls[0]?.content).toContain('"backend_context_version":"1.0"');
  });

  it("logs a CANARY_DECISION_LOGGED event for every processed message, independent of route", async () => {
    const testDeps = deps('{"contract_version":"1.0","reply":"Cevap","internal_boss_note":""}');

    await handleIncomingMessage(message(), testDeps);

    expect(testDeps.logger.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "CANARY_DECISION_LOGGED",
          correlation_id: "corr_test",
          use_adapter_layer: false,
          reason: "disabled_mode_off",
          canary_scope: "off",
          evaluation_point: "pre_dispatch"
        })
      ])
    );
  });

  it("logs one structured request latency breakdown with phase durations", async () => {
    const testDeps = {
      ...deps('{"contract_version":"1.0","reply":"Cevap","internal_boss_note":""}'),
      nowMs: (() => {
        const marks = [1030, 1040, 1050, 1080, 1090, 1100, 1110];
        let index = 0;
        return () => marks[index++] ?? 1110;
      })()
    };

    const result = await handleIncomingMessage(
      message({
        telemetry: {
          webhook_received_at_ms: 1000,
          normalized_at_ms: 1010
        }
      }),
      testDeps
    );

    expect(result.status).toBe("sent");
    const breakdown = testDeps.logger.events.filter((event) => event.event_type === "REQUEST_LATENCY_BREAKDOWN");
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0]).toEqual(expect.objectContaining({
      event_type: "REQUEST_LATENCY_BREAKDOWN",
      correlation_id: "corr_test",
      message_id: "msg_test",
      chat_type: "private",
      status: "sent",
      webhook_received_to_normalized_ms: 10,
      normalized_to_state_machine_done_ms: 20,
      state_machine_to_route_selected_ms: 10,
      model_start_to_model_result_ms: 30,
      route_selected_to_send_start_ms: 50,
      send_start_to_send_confirmed_ms: 10,
      total_duration_ms: 110
    }));
  });

  it("sends fallback for invalid Assistant response", async () => {
    const testDeps = deps("plain text");

    const result = await handleIncomingMessage(message(), testDeps);

    expect(result.status).toBe("fallback_sent");
    expect(testDeps.sender.sends[0]?.text).toBe(ASSISTANT_SAFE_FALLBACK_REPLY);
    expect(testDeps.logger.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "WARN",
          event_type: "ASSISTANT_RESPONSE_INVALID",
          correlation_id: "corr_test",
          assistant_response_contract_version: "1.0",
          system_prompt_version: "1.0.0",
          knowledge_base_version: "2026.07.04",
          backend_context_version: "1.0",
          state_machine_version: "1.0",
          message_id: "msg_test",
          conversation_id: "905***",
          sender: {
            sender_id: "905***",
            phone_number: "905***"
          },
          error_code: "INVALID_JSON",
          error_message: "Assistant response must be valid JSON",
          raw_preview: "plain text"
        })
      ])
    );
  });

  it("logs unsupported contract version as ERROR", async () => {
    const testDeps = deps('{"contract_version":"1.1","reply":"x","internal_boss_note":""}');

    await handleIncomingMessage(message(), testDeps);

    expect(testDeps.logger.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "ERROR",
          event_type: "ASSISTANT_RESPONSE_INVALID",
          error_code: "UNSUPPORTED_CONTRACT_VERSION"
        })
      ])
    );
  });

  it("serializes runs for the same phone number", async () => {
    const order: string[] = [];
    const assistantClient = new FakeAssistantClient([
      '{"contract_version":"1.0","reply":"Bir","internal_boss_note":""}',
      '{"contract_version":"1.0","reply":"Iki","internal_boss_note":""}'
    ]);
    const originalRun = assistantClient.runAssistant.bind(assistantClient);
    assistantClient.runAssistant = async (threadId, content) => {
      order.push("start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      const result = await originalRun(threadId, content);
      order.push("end");
      return result;
    };
    const testDeps = {
      env: createTestEnv(),
      assistantClient,
      sender: new FakeSender(),
      threadStore: new InMemoryThreadStore(),
      memoryStore: new InMemoryStore(),
      messageDedupeStore: new InMemoryMessageDedupeStore(),
      userRunLock: new UserRunLock(),
      logger: createSilentLogger()
    };

    await Promise.all([
      handleIncomingMessage(message({ correlation_id: "corr_1", message_id: "msg_1" }), testDeps),
      handleIncomingMessage(message({ correlation_id: "corr_2", message_id: "msg_2" }), testDeps)
    ]);

    expect(order).toEqual(["start", "end", "start", "end"]);
    expect(testDeps.sender.sends.map((send) => send.text)).toEqual(["Bir", "Iki"]);
  });

  it("returns reply_send_failed and logs SEND_TEXT_FAILED when sendText returns 401", async () => {
    const assistantClient = new FakeAssistantClient([
      '{"contract_version":"1.0","reply":"Cevap","internal_boss_note":"sadece log"}'
    ]);
    const sender = new FailingSender(401);
    const testDeps = {
      env: createTestEnv({ evolutionInstance: "nowakademi_bot" }),
      assistantClient,
      sender,
      threadStore: new InMemoryThreadStore(),
      memoryStore: new InMemoryStore(),
      messageDedupeStore: new InMemoryMessageDedupeStore(),
      userRunLock: new UserRunLock(),
      logger: createSilentLogger()
    };

    const result = await handleIncomingMessage(message(), testDeps);

    expect(result).toEqual({
      status: "reply_send_failed",
      correlation_id: "corr_test",
      error_layer: "EvolutionSendText"
    });
    expect(sender.sends).toHaveLength(1);
    expect(sender.sends[0]?.text).toBe("Cevap");
    expect(sender.sends[0]?.text).not.toContain("sadece log");
    expect(testDeps.logger.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "ERROR",
          event_type: "SEND_TEXT_FAILED",
          correlation_id: "corr_test",
          message_id: "msg_test",
          masked_phone: "905***",
          instance: "nowakademi_bot",
          http_status: 401,
          error_layer: "EvolutionSendText"
        })
      ])
    );
  });

  it("does not call Assistant or send reply for duplicate message_id", async () => {
    const assistantClient = new FakeAssistantClient([
      '{"contract_version":"1.0","reply":"Bir","internal_boss_note":""}',
      '{"contract_version":"1.0","reply":"Iki","internal_boss_note":""}'
    ]);
    const sender = new FakeSender();
    const testDeps = {
      env: createTestEnv(),
      assistantClient,
      sender,
      threadStore: new InMemoryThreadStore(),
      memoryStore: new InMemoryStore(),
      messageDedupeStore: new InMemoryMessageDedupeStore(),
      userRunLock: new UserRunLock(),
      logger: createSilentLogger()
    };

    const first = await handleIncomingMessage(message({ correlation_id: "corr_1" }), testDeps);
    const second = await handleIncomingMessage(message({ correlation_id: "corr_2" }), testDeps);

    expect(first.status).toBe("sent");
    expect(second).toEqual({ status: "duplicate_ignored", correlation_id: "corr_2" });
    expect(assistantClient.runCalls).toHaveLength(1);
    expect(sender.sends).toHaveLength(1);
  });

  it("blocks unapproved app suggestions and sends safe replacement reply", async () => {
    const testDeps = deps(
      '{"contract_version":"1.0","reply":"TikTok veya Instagram ile başlayabilirsin","internal_boss_note":"unsafe internal"}'
    );

    const result = await handleIncomingMessage(message({ text: "Isi bilmeden uygulama secemem" }), testDeps);

    expect(result.status).toBe("sent");
    expect(testDeps.sender.sends).toHaveLength(1);
    expect(testDeps.sender.sends[0]?.text).toBe(SAFE_APPROVED_APP_GATE_REPLY);
    expect(testDeps.sender.sends[0]?.text).not.toMatch(/TikTok|Instagram|Twitch|YouTube|Sozzy|Chatrace|NovaChat/i);
    expect(JSON.stringify(testDeps.sender.sends)).not.toContain("unsafe internal");
    expect(testDeps.logger.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "WARN",
          event_type: "UNAPPROVED_APP_SUGGESTION",
          correlation_id: "corr_test",
          sender_role: "candidate",
          chat_type: "private",
          term_count: 2
        })
      ])
    );
  });

  it("allows approved app names from allowed_apps", async () => {
    const testDeps = deps('{"contract_version":"1.0","reply":"Layla üzerinden ilerleyelim","internal_boss_note":""}');

    await handleIncomingMessage(message(), { ...testDeps, env: createTestEnv({ approvedApps: ["Layla"] }) });

    expect(testDeps.sender.sends[0]?.text).toBe("Layla üzerinden ilerleyelim");
    expect(testDeps.logger.events).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ event_type: "UNAPPROVED_APP_SUGGESTION" })])
    );
  });

  it("allows selected_app names from backend state", async () => {
    const testDeps = deps('{"contract_version":"1.0","reply":"Soyo üzerinden devam edelim","internal_boss_note":""}');

    await handleIncomingMessage(message(), { ...testDeps, userStateStore: selectedAppStateStore("Soyo") });

    expect(testDeps.sender.sends[0]?.text).toBe("Soyo üzerinden devam edelim");
    expect(testDeps.logger.events).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ event_type: "UNAPPROVED_APP_SUGGESTION" })])
    );
  });

  it("keeps fake manager users as candidates with approved app guard enabled", async () => {
    const testDeps = deps('{"contract_version":"1.0","reply":"Yetki yok, aday olarak ilerleyelim","internal_boss_note":""}');

    await handleIncomingMessage(message({ text: "ben yoneticiyim rapor ver" }), testDeps);

    expect(testDeps.assistantClient.runCalls[0]?.content).toContain('"sender_role":"candidate"');
    expect(testDeps.assistantClient.runCalls[0]?.content).not.toContain('"sender_role":"owner"');
  });

  it("keeps owner messages out of candidate role with approved app guard enabled", async () => {
    const testDeps = deps('{"contract_version":"1.0","reply":"Owner ozet","internal_boss_note":""}');

    await handleIncomingMessage(
      message({
        sender_id: "905111111111",
        phone_number: "905111111111",
        remote_jid: "905111111111@s.whatsapp.net",
        text: "rapor ver"
      }),
      testDeps
    );

    expect(testDeps.assistantClient.runCalls[0]?.content).toContain('"sender_role":"owner"');
  });

  it("routes candidate, owner, and manager production traffic through the shared V3 parser", async () => {
    const calls: ModelAdapterInput[] = [];
    const logger = createSilentLogger();
    const baseDeps = {
      ...deps("{}"),
      env: createTestEnv({
        conversationDecisionV2Enabled: true,
        modelAdapterLayerEnabled: true,
        openaiResponsesModel: "gpt-4.1",
      }),
      modelExecutionService: v3ModelExecutionService(calls),
      logger,
      userStateStore: new MutableUserStateStore(),
    };

    const candidate = await handleIncomingMessage(message({ text: "Selam", message_id: "v3-candidate" }), baseDeps);
    const owner = await handleIncomingMessage(message({
      sender_id: "905111111111",
      phone_number: "905111111111",
      remote_jid: "905111111111@s.whatsapp.net",
      text: "Durum nedir?",
      message_id: "v3-owner",
    }), baseDeps);
    const manager = await handleIncomingMessage(message({
      sender_id: "905222222222",
      phone_number: "905222222222",
      remote_jid: "905222222222@s.whatsapp.net",
      text: "Kisa ozet ver",
      message_id: "v3-manager",
    }), baseDeps);

    expect(candidate.status).toBe("sent");
    expect(owner.status).toBe("sent");
    expect(manager.status).toBe("sent");
    expect(calls.map((call) => call.senderRole)).toEqual(["candidate", "owner", "owner"]);
    expect(baseDeps.sender.sends).toHaveLength(3);
    expect(baseDeps.sender.sends[0]?.text).toBe("candidate V3 ortak parser cevabi");
    expect(baseDeps.sender.sends[1]?.text).toContain("owner V3 ortak parser cevabi");
    expect(baseDeps.sender.sends[2]?.text).toContain("owner V3 ortak parser cevabi");
    expect(logger.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: "CONVERSATION_MODEL_ROUTE_SELECTED", model_route: "conversation_decision_v2", sender_role: "candidate" }),
      expect.objectContaining({ event_type: "CONVERSATION_MODEL_ROUTE_SELECTED", model_route: "conversation_decision_v2", sender_role: "owner" }),
      expect.objectContaining({ event_type: "CONVERSATION_MODEL_ROUTE_SELECTED", model_route: "conversation_decision_v2", sender_role: "owner" }),
    ]));
    expect(logger.events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: "ASSISTANT_RESPONSE_INVALID" }),
    ]));
    expect(baseDeps.assistantClient.runCalls).toHaveLength(0);
  });

  it("keeps group mode behavior with approved app guard enabled", async () => {
    const testDeps = deps('{"contract_version":"1.0","reply":"Grup modu aktif","internal_boss_note":""}');

    await handleIncomingMessage(
      message({
        sender_id: "905333333333",
        phone_number: "905333333333",
        remote_jid: "120363000000000000@g.us",
        chat_type: "group",
        is_group: true
      }),
      testDeps
    );

    expect(testDeps.assistantClient.runCalls[0]?.content).toContain('"chat_type":"group"');
  });

  it("updates backend_context with candidate phone_type before Assistant run", async () => {
    const userStateStore = new MutableUserStateStore();
    const testDeps = deps('{"contract_version":"1.0","reply":"App secimini netlestirelim","internal_boss_note":""}');

    await handleIncomingMessage(message({ text: "Android kullanıyorum" }), { ...testDeps, userStateStore });

    expect(testDeps.assistantClient.runCalls[0]?.content).toContain('"phone_type":"android"');
    expect(testDeps.assistantClient.runCalls[0]?.content).toContain('"missing_fields":["selected_app"]');
    expect(testDeps.assistantClient.runCalls[0]?.content).toContain('"expected_next_step":"ask_selected_app"');
    expect(testDeps.assistantClient.runCalls[0]?.content).not.toContain('"expected_next_step":"ask_selected_app_or_phone_type"');
  });

  it("updates backend_context with approved selected_app before Assistant run", async () => {
    const userStateStore = new MutableUserStateStore();
    const testDeps = deps('{"contract_version":"1.0","reply":"Telefon tipini netlestirelim","internal_boss_note":""}');

    await handleIncomingMessage(message({ text: "Layla ile ilerleyelim" }), {
      ...testDeps,
      env: createTestEnv({ approvedApps: ["Layla", "Soyo"] }),
      userStateStore
    });

    expect(testDeps.assistantClient.runCalls[0]?.content).toContain('"selected_app":"Layla"');
    expect(testDeps.assistantClient.runCalls[0]?.content).toContain('"missing_fields":["phone_type"]');
    expect(testDeps.assistantClient.runCalls[0]?.content).toContain('"expected_next_step":"ask_phone_type"');
  });

  it("does not persist unapproved app names but keeps Approved App Gate active", async () => {
    const userStateStore = new MutableUserStateStore();
    const testDeps = deps(
      '{"contract_version":"1.0","reply":"TikTok veya Instagram ile baslayabilirsin","internal_boss_note":""}'
    );

    await handleIncomingMessage(message({ text: "TikTok istiyorum" }), {
      ...testDeps,
      env: createTestEnv({ approvedApps: ["Layla"] }),
      userStateStore
    });

    expect(testDeps.assistantClient.runCalls[0]?.content).toContain('"selected_app":null');
    expect(testDeps.sender.sends[0]?.text).toBe(SAFE_APPROVED_APP_GATE_REPLY);
    expect(testDeps.sender.sends[0]?.text).not.toMatch(/TikTok|Instagram|Twitch|YouTube|Sozzy|Chatrace|NovaChat/i);
    expect(testDeps.logger.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: "STATE_UNAPPROVED_APP_IGNORED" }),
        expect.objectContaining({ event_type: "UNAPPROVED_APP_SUGGESTION" })
      ])
    );
  });

  it("keeps candidate onboarding out of owner backend_context", async () => {
    const userStateStore = new MutableUserStateStore();
    const testDeps = deps('{"contract_version":"1.0","reply":"Owner ozet","internal_boss_note":""}');

    await handleIncomingMessage(
      message({
        sender_id: "905111111111",
        phone_number: "905111111111",
        remote_jid: "905111111111@s.whatsapp.net",
        text: "rapor ver"
      }),
      { ...testDeps, userStateStore }
    );

    expect(testDeps.assistantClient.runCalls[0]?.content).toContain('"sender_role":"owner"');
    expect(testDeps.logger.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: "STATE_TRANSITION_SKIPPED", skipped_reason: "non_candidate_role" })
      ])
    );
    expect(userStateStore.states.size).toBe(0);
  });

  it("passes report_summary to Assistant for owner report intent without candidate onboarding", async () => {
    const userStateStore = new MutableUserStateStore();
    const reportDataSource = new InMemoryReportDataSource([
      {
        user_id: "user_hash",
        sender_masked: "905***",
        current_state: "READY_FOR_INSTALLATION",
        selected_app: "Layla",
        phone_type: "android",
        missing_fields: [],
        expected_next_step: "start_installation",
        last_seen_at: "2026-07-06T00:00:00.000Z"
      }
    ]);
    reportDataSource.mutableQueueStore.upsertOpenItem({
      user_id: "user_hash",
      sender_masked: "905***",
      reason: "support_signal",
      priority: "HIGH",
      current_state: "READY_FOR_INSTALLATION",
      missing_fields: [],
      expected_next_step: "start_installation",
      last_seen_at: "2026-07-06T00:00:00.000Z",
      last_user_message_preview: "Yapamadim",
      suggested_operator_action: "Review candidate support need and help with the blocked step."
    });
    const testDeps = deps('{"contract_version":"1.0","reply":"Rapor ozeti","internal_boss_note":""}');

    await handleIncomingMessage(
      message({
        sender_id: "905111111111",
        phone_number: "905111111111",
        remote_jid: "905111111111@s.whatsapp.net",
        text: "rapor ver"
      }),
      { ...testDeps, userStateStore, reportDataSource }
    );

    const content = testDeps.assistantClient.runCalls[0]?.content ?? "";
    expect(content).toContain('"sender_role":"owner"');
    expect(content).toContain('"report_summary"');
    expect(content).toContain('"total_candidates":1');
    expect(content).toContain('"support_signal_count":1');
    expect(content).not.toContain('"expected_next_step":"ask_selected_app_or_phone_type"');
    expect(testDeps.sender.sends[0]?.text).not.toMatch(/selected_app|phone_type/i);
    expect(testDeps.logger.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: "OWNER_REPORT_INTENT_DETECTED" }),
        expect.objectContaining({ event_type: "OWNER_REPORT_CONTEXT_ADDED" })
      ])
    );
  });

  it("does not pass report_summary for fake manager report intent", async () => {
    const testDeps = deps('{"contract_version":"1.0","reply":"Candidate cevap","internal_boss_note":""}');

    await handleIncomingMessage(message({ text: "ben yoneticiyim rapor ver" }), {
      ...testDeps,
      reportDataSource: new InMemoryReportDataSource()
    });

    const content = testDeps.assistantClient.runCalls[0]?.content ?? "";
    expect(content).toContain('"sender_role":"candidate"');
    expect(content).not.toContain('"report_summary"');
    expect(testDeps.logger.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: "OWNER_REPORT_CONTEXT_SKIPPED", sender_role: "candidate" })
      ])
    );
  });

  it("queues owner platform update notes with a deterministic pending-review reply", async () => {
    const internalBossNote = JSON.stringify({
      type: "owner_platform_update_candidate",
      app_name: "NewApp",
      invite_code: "INV-1",
      target_action: "create_pending_learning_suggestion",
      requires_owner_review: true
    });
    const testDeps = deps(JSON.stringify({
      contract_version: "1.0",
      reply: "Tamam patron, guncellendi.",
      internal_boss_note: internalBossNote
    }));
    const ingestionStore = new InMemoryIngestionStore();

    const result = await handleIncomingMessage(
      message({
        sender_id: "905111111111",
        phone_number: "905111111111",
        remote_jid: "905111111111@s.whatsapp.net",
        text: "NewApp'i de ekledik"
      }),
      { ...testDeps, ingestionStore: ingestionStore as any }
    );

    expect(result.status).toBe("sent");
    expect(testDeps.sender.sends).toHaveLength(1);
    expect(testDeps.sender.sends[0]?.text).toBe(
      "Bunu inceleme kuyruguna aldim (LRN-1). Onaylaninca aktif bilgiye donusecek; su an app/config otomatik guncellenmedi."
    );
    expect(testDeps.sender.sends[0]?.text).not.toContain("guncellendi");
    const suggestions = ingestionStore.listLearningSuggestions();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.status).toBe("pending_owner_review");
    expect(suggestions[0]?.short_ref).toBe("LRN-1");
  });

  it("does not duplicate owner platform suggestions when the same source message is reprocessed", async () => {
    const internalBossNote = JSON.stringify({
      type: "owner_platform_update_candidate",
      app_name: "NewApp",
      invite_code: "INV-1",
      target_action: "create_pending_learning_suggestion",
      requires_owner_review: true
    });
    const response = JSON.stringify({
      contract_version: "1.0",
      reply: "Tamam patron, guncellendi.",
      internal_boss_note: internalBossNote
    });
    const ingestionStore = new InMemoryIngestionStore();
    const firstDeps = deps(response);
    const secondDeps = deps(response);
    const ownerMessage = message({
      sender_id: "905111111111",
      phone_number: "905111111111",
      remote_jid: "905111111111@s.whatsapp.net",
      message_id: "owner_msg_1",
      text: "NewApp'i de ekledik"
    });

    await handleIncomingMessage(ownerMessage, { ...firstDeps, ingestionStore: ingestionStore as any });
    await handleIncomingMessage(ownerMessage, { ...secondDeps, ingestionStore: ingestionStore as any });

    const suggestions = ingestionStore.listLearningSuggestions();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.source_message_safe_ref).toBe("owner_msg_1");
    expect(secondDeps.sender.sends[0]?.text).toBe(
      "Bu not zaten inceleme kuyrugunda (LRN-1). Yeni duplicate kayit acmadim; onaylaninca aktif bilgiye donusecek."
    );
    expect(secondDeps.logger.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "OWNER_PLATFORM_UPDATE_SUGGESTION_DUPLICATE_SKIPPED",
          suggestion_ref: "LRN-1",
          source_message_safe_ref: "owner_msg_1"
        })
      ])
    );
  });

  it("shows pending owner learning suggestions through a deterministic command without Assistant", async () => {
    const testDeps = deps("{}");
    const ingestionStore = new InMemoryIngestionStore();
    ingestionStore.saveLearningSuggestion({
      suggestion_id: "sug_pending",
      source_job_id: "live_owner_interaction",
      platform: "whatsapp",
      suggestion_class: "unknown",
      evidence_preview_sanitized: "App: NewApp, Invite: INV-1",
      proposed_knowledge_type: "approved_app_update",
      proposed_text: "Uygulama Adi: NewApp",
      confidence: 0.99,
      status: "pending_owner_review",
      created_at: "2026-07-22T00:00:00.000Z"
    });

    const result = await handleIncomingMessage(
      message({
        sender_id: "905111111111",
        phone_number: "905111111111",
        remote_jid: "905111111111@s.whatsapp.net",
        text: "beklemedeki onerileri goster"
      }),
      {
        ...testDeps,
        ingestionStore: ingestionStore as any,
        maintenanceStore: {
          isEnabled: () => false,
          setEnabled: () => undefined
        }
      }
    );

    expect(result.status).toBe("sent");
    expect(testDeps.assistantClient.runCalls).toHaveLength(0);
    expect(testDeps.sender.sends[0]?.text).toContain("Bekleyen Ogrenme Onerileri (1)");
    expect(testDeps.sender.sends[0]?.text).toContain("LRN-1: approved_app_update");
    expect(testDeps.sender.sends[0]?.text).toContain("Onaylanmadan aktif bilgi/config degismez.");
  });
});
