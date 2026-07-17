import { evaluateFollowUpQueue } from "../bridge/followUpQueue.js";
import type { NormalizedIncomingMessage } from "../bridge/normalizeEvolutionMessage.js";
import type { BackendContextPayloadV1 } from "../contracts/backendContextPayload.js";
import { defaultUserState, type QueueItemReason, type UserState } from "../storage/types.js";
import { createSilentLogger, InMemoryQueueStore } from "./testDoubles.js";

function message(overrides: Partial<NormalizedIncomingMessage> = {}): NormalizedIncomingMessage {
  return {
    correlation_id: "corr_queue",
    sender_id: "905333333333",
    phone_number: "905333333333",
    remote_jid: "905333333333@s.whatsapp.net",
    message_id: "msg_queue",
    message_type: "conversation",
    text: "Merhaba",
    chat_type: "private",
    is_from_me: false,
    is_group: false,
    received_at: "2026-07-06T00:00:00.000Z",
    ...overrides
  };
}

function context(state: UserState, overrides: Partial<BackendContextPayloadV1> = {}): BackendContextPayloadV1 {
  return {
    backend_context_version: "1.0",
    correlation_id: "corr_queue",
    sender_role: "candidate",
    chat_type: "private",
    sender: {
      sender_id: "905333333333",
      phone_number: "905333333333"
    },
    chat: {
      remote_jid: "905333333333@s.whatsapp.net",
      message_id: "msg_queue",
      message_type: "conversation",
      is_from_me: false,
      is_group: false
    },
    allowed_apps: ["Layla"],
    state,
    memory: {
      conversation_summary: "",
      last_5_user_messages: [],
      last_5_bot_replies: [],
      last_10_messages: [],
      last_intent: null,
      summary: null
    },
    versions: {
      assistant_response_contract_version: "1.0",
      system_prompt_version: "1.0.0",
      knowledge_base_version: "2026.07.04",
      backend_context_version: "1.0",
      state_machine_version: "1.0"
    },
    user_message: {
      text: "Merhaba",
      received_at: "2026-07-06T00:00:00.000Z"
    },
    ...overrides
  };
}

function reasons(store: InMemoryQueueStore): QueueItemReason[] {
  return store.listItems().map((item) => item.reason);
}

describe("Follow-up & Missing Info Queue", () => {
  it("creates missing info items when selected_app and phone_type are missing", () => {
    const store = new InMemoryQueueStore();

    evaluateFollowUpQueue(message(), context(defaultUserState()), store, undefined, createSilentLogger());

    expect(reasons(store)).toEqual(
      expect.arrayContaining(["missing_selected_app", "missing_phone_type", "missing_selected_app_and_phone_type"])
    );
    expect(store.getSummary().open_missing_info_count).toBe(3);
  });

  it("dedupes same user and same reason while item is open", () => {
    const store = new InMemoryQueueStore();
    const queueContext = context(defaultUserState());

    evaluateFollowUpQueue(message({ text: "Merhaba" }), queueContext, store, undefined, createSilentLogger());
    evaluateFollowUpQueue(message({ text: "Tekrar merhaba" }), queueContext, store, undefined, createSilentLogger());

    const openMissingSelectedApp = store
      .listItems()
      .filter((item) => item.reason === "missing_selected_app" && item.status === "open");
    expect(openMissingSelectedApp).toHaveLength(1);
    expect(store.listItems()).toHaveLength(3);
  });

  it("resolves phone_type missing items after Android is captured", () => {
    const store = new InMemoryQueueStore();
    evaluateFollowUpQueue(message(), context(defaultUserState()), store, undefined, createSilentLogger());

    evaluateFollowUpQueue(
      message({ text: "Android" }),
      context({
        ...defaultUserState(),
        current_state: "WAITING_FOR_APP",
        phone_type: "android",
        missing_fields: ["selected_app"],
        expected_next_step: "ask_selected_app"
      }),
      store,
      undefined,
      createSilentLogger()
    );

    const items = store.listItems();
    expect(items.find((item) => item.reason === "missing_phone_type")?.status).toBe("resolved");
    expect(items.find((item) => item.reason === "missing_selected_app_and_phone_type")?.status).toBe("resolved");
    expect(items.find((item) => item.reason === "missing_selected_app")?.status).toBe("open");
  });

  it("resolves selected_app missing items after Layla is captured", () => {
    const store = new InMemoryQueueStore();
    evaluateFollowUpQueue(
      message({ text: "Android" }),
      context({
        ...defaultUserState(),
        current_state: "WAITING_FOR_APP",
        phone_type: "android",
        missing_fields: ["selected_app"],
        expected_next_step: "ask_selected_app"
      }),
      store,
      undefined,
      createSilentLogger()
    );

    evaluateFollowUpQueue(
      message({ text: "Layla" }),
      context({
        ...defaultUserState(),
        current_state: "READY_FOR_INSTALLATION",
        selected_app: "Layla",
        phone_type: "android",
        missing_fields: [],
        expected_next_step: "start_installation"
      }),
      store,
      undefined,
      createSilentLogger()
    );

    const items = store.listItems();
    expect(items.find((item) => item.reason === "missing_selected_app")?.status).toBe("resolved");
    expect(reasons(store)).toContain("ready_for_installation_followup");
  });

  it("creates ready_for_installation follow-up with HIGH priority", () => {
    const store = new InMemoryQueueStore();

    evaluateFollowUpQueue(
      message({ text: "Layla" }),
      context({
        ...defaultUserState(),
        current_state: "READY_FOR_INSTALLATION",
        selected_app: "Layla",
        phone_type: "android",
        missing_fields: [],
        expected_next_step: "start_installation"
      }),
      store,
      undefined,
      createSilentLogger()
    );

    const item = store.listItems().find((queueItem) => queueItem.reason === "ready_for_installation_followup");
    expect(item?.priority).toBe("HIGH");
  });

  it("creates HIGH support signal and payment/trust follow-up items", () => {
    const store = new InMemoryQueueStore();

    evaluateFollowUpQueue(message({ text: "Yapamadım, olmuyor" }), context(defaultUserState()), store, undefined, createSilentLogger());
    evaluateFollowUpQueue(message({ text: "ödeme" }), context(defaultUserState()), store, undefined, createSilentLogger());

    const support = store.listItems().find((item) => item.reason === "support_signal");
    const payment = store.listItems().find((item) => item.reason === "payment_or_trust_question");
    expect(support?.priority).toBe("HIGH");
    expect(payment?.priority).toBe("HIGH");
    expect(store.getSummary().high_priority_count).toBe(2);
  });

  it("detects Turkish dotless support signal in Yapamadım", () => {
    const store = new InMemoryQueueStore();

    evaluateFollowUpQueue(message({ text: "Yapamadım" }), context(defaultUserState()), store, undefined, createSilentLogger());

    const support = store.listItems().find((item) => item.reason === "support_signal");
    expect(support?.priority).toBe("HIGH");
  });

  it("does not create queue items for owner or group contexts", () => {
    const store = new InMemoryQueueStore();

    evaluateFollowUpQueue(
      message({ text: "rapor ver" }),
      context(defaultUserState(), { sender_role: "owner" }),
      store,
      undefined,
      createSilentLogger()
    );
    evaluateFollowUpQueue(
      message({ remote_jid: "120363000000000000@g.us", chat_type: "group", is_group: true }),
      context(defaultUserState(), { chat_type: "group" }),
      store,
      undefined,
      createSilentLogger()
    );

    expect(store.listItems()).toHaveLength(0);
  });

  it("keeps fake manager as candidate queue input without owner privileges", () => {
    const store = new InMemoryQueueStore();

    evaluateFollowUpQueue(message({ phone_number: "905222222222" }), context(defaultUserState(), { sender_role: "candidate" }), store, undefined, createSilentLogger());

    expect(store.listItems().length).toBeGreaterThan(0);
    expect(store.getSummary().open_missing_info_count).toBeGreaterThan(0);
  });

  it("summary helper returns owner report ready counts", () => {
    const store = new InMemoryQueueStore();
    evaluateFollowUpQueue(message(), context(defaultUserState()), store, undefined, createSilentLogger());
    evaluateFollowUpQueue(
      message({ text: "Layla" }),
      context({
        ...defaultUserState(),
        current_state: "READY_FOR_INSTALLATION",
        selected_app: "Layla",
        phone_type: "android",
        missing_fields: [],
        expected_next_step: "start_installation"
      }),
      store,
      undefined,
      createSilentLogger()
    );

    const summary = store.getSummary();
    expect(summary.open_missing_info_count).toBe(0);
    expect(summary.open_follow_up_count).toBe(2);
    expect(summary.high_priority_count).toBe(1);
    expect(summary.users_ready_for_installation).toBe(1);
    expect(summary.open_items_by_reason.ready_for_installation_followup).toBe(1);
  });
});
