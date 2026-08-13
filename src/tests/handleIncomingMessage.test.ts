import { handleIncomingMessage } from "../bridge/handleIncomingMessage.js";
import { SAFE_APPROVED_APP_GATE_REPLY } from "../bridge/approvedAppGuard.js";
import { ASSISTANT_SAFE_FALLBACK_REPLY } from "../contracts/assistantResponseContract.js";
import { UserRunLock } from "../queue/userRunLock.js";
import { InMemoryStore } from "../storage/memoryStore.js";
import { InMemoryMessageDedupeStore } from "../storage/messageDedupeStore.js";
import { InMemoryThreadStore } from "../storage/threadStore.js";
import { defaultUserState, type UserStateStore } from "../storage/types.js";
import type { NormalizedIncomingMessage } from "../bridge/normalizeEvolutionMessage.js";
import {
  createSilentLogger,
  createTestEnv,
  FailingSender,
  FakeAssistantClient,
  FakeSender,
  InMemoryIngestionStore,
  InMemoryReportDataSource
} from "./testDoubles.js";

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
