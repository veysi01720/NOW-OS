import { applyCandidateIntakeStateMachine } from "../bridge/candidateIntakeStateMachine.js";
import { normalizeEvolutionMessage, type NormalizedIncomingMessage } from "../bridge/normalizeEvolutionMessage.js";
import { defaultUserState, type UserIdentityInput, type UserState, type UserStateStore } from "../storage/types.js";
import { createTestEnv } from "./testDoubles.js";

class TestUserStateStore implements UserStateStore {
  public states = new Map<string, UserState>();

  getOrCreateState(userId: string, defaults: UserState, _identity?: UserIdentityInput): UserState {
    const existing = this.states.get(userId);
    if (existing !== undefined) {
      return { ...existing, missing_fields: [...existing.missing_fields] };
    }

    const created = { ...defaults, missing_fields: [...defaults.missing_fields] };
    this.states.set(userId, created);
    return { ...created, missing_fields: [...created.missing_fields] };
  }

  updateState(userId: string, state: UserState, _identity?: UserIdentityInput): void {
    this.states.set(userId, { ...state, missing_fields: [...state.missing_fields] });
  }
}

function message(overrides: Partial<NormalizedIncomingMessage> = {}): NormalizedIncomingMessage {
  return {
    correlation_id: "corr_spec011",
    sender_id: "905333333333",
    phone_number: "905333333333",
    remote_jid: "905333333333@s.whatsapp.net",
    message_id: "msg_spec011",
    message_type: "conversation",
    text: "Merhaba",
    chat_type: "private",
    is_from_me: false,
    is_group: false,
    received_at: "2026-07-06T00:00:00.000Z",
    ...overrides
  };
}

describe("Candidate Intake State Machine", () => {
  it("keeps first candidate message in NEW_LEAD with selected_app and phone_type missing", () => {
    const store = new TestUserStateStore();

    const result = applyCandidateIntakeStateMachine(
      message(),
      createTestEnv({ approvedApps: ["Layla", "Soyo"] }),
      store
    );

    expect(result.applied).toBe(true);
    expect(result.next_state.current_state).toBe("NEW_LEAD");
    expect(result.next_state.missing_fields).toEqual(["age", "gender", "daily_hours", "selected_app", "phone_type"]);
    expect(result.next_state.expected_next_step).toBe("ask_intake_info");
  });

  it("captures Android and stops asking for phone_type", () => {
    const store = new TestUserStateStore();

    const result = applyCandidateIntakeStateMachine(
      message({ text: "Android telefon kullanıyorum" }),
      createTestEnv({ approvedApps: ["Layla"] }),
      store
    );

    expect(result.next_state.phone_type).toBe("android");
    expect(result.next_state.selected_app).toBeNull();
    expect(result.next_state.missing_fields).toEqual(["age", "gender", "daily_hours", "selected_app"]);
    expect(result.next_state.expected_next_step).toBe("ask_intake_info");
    expect(result.captured_fields).toEqual(["phone_type"]);
  });

  it("captures iPhone/iOS as ios", () => {
    const store = new TestUserStateStore();

    const result = applyCandidateIntakeStateMachine(
      message({ text: "iPhone var bende" }),
      createTestEnv({ approvedApps: ["Layla"] }),
      store
    );

    expect(result.next_state.phone_type).toBe("ios");
    expect(result.next_state.missing_fields).toEqual(["age", "gender", "daily_hours", "selected_app"]);
  });

  it("does not update phone_type when Android and iOS are mentioned ambiguously", () => {
    const store = new TestUserStateStore();

    const result = applyCandidateIntakeStateMachine(
      message({ text: "Android mi iOS mu bilmiyorum" }),
      createTestEnv({ approvedApps: ["Layla"] }),
      store
    );

    expect(result.ambiguous_phone_type).toBe(true);
    expect(result.next_state.phone_type).toBeNull();
    expect(result.next_state.missing_fields).toEqual(["age", "gender", "daily_hours", "selected_app", "phone_type"]);
  });

  it("captures only approved app names", () => {
    const store = new TestUserStateStore();

    const result = applyCandidateIntakeStateMachine(
      message({ text: "Layla ile ilerlemek istiyorum" }),
      createTestEnv({ approvedApps: ["Layla", "Soyo"] }),
      store
    );

    expect(result.next_state.selected_app).toBe("Layla");
    expect(result.next_state.missing_fields).toEqual(["age", "gender", "daily_hours", "phone_type"]);
    expect(result.next_state.expected_next_step).toBe("ask_intake_info");
    expect(result.captured_fields).toEqual(["selected_app"]);
  });

  it("does not persist unapproved app names", () => {
    const store = new TestUserStateStore();

    const result = applyCandidateIntakeStateMachine(
      message({ text: "TikTok ile ilerleyelim" }),
      createTestEnv({ approvedApps: ["Layla", "Soyo"] }),
      store
    );

    expect(result.ignored_unapproved_app).toBe(true);
    expect(result.next_state.selected_app).toBeNull();
    expect(result.next_state.missing_fields).toEqual(["age", "gender", "daily_hours", "selected_app", "phone_type"]);
  });

  it("requires work model disclosure before installation even when approved app and phone_type are both present", () => {
    const store = new TestUserStateStore();

    const result = applyCandidateIntakeStateMachine(
      message({ text: "25 kadın 4 saat Layla ve Android" }),
      createTestEnv({ approvedApps: ["Layla"] }),
      store
    );

    expect(result.next_state.selected_app).toBe("Layla");
    expect(result.next_state.phone_type).toBe("android");
    expect(result.next_state.age).toBe(25);
    expect(result.next_state.gender).toBe("kadın");
    expect(result.next_state.daily_hours).toBe(4);
    expect(result.next_state.missing_fields).toEqual(["model_acceptance"]);
    expect(result.next_state.current_state).toBe("WORK_MODEL_DISCLOSURE");
    expect(result.next_state.expected_next_step).toBe("explain_work_model_and_ask_acceptance");
  });

  it("captures age, gender and daily hours from compact intake text", () => {
    const store = new TestUserStateStore();

    const result = applyCandidateIntakeStateMachine(
      message({ text: "27 erkek 4" }),
      createTestEnv({ approvedApps: ["Layla"] }),
      store
    );

    expect(result.next_state.age).toBe(27);
    expect(result.next_state.gender).toBe("erkek");
    expect(result.next_state.daily_hours).toBe(4);
    expect(result.next_state.missing_fields).toEqual(["model_acceptance"]);
    expect(result.next_state.current_state).toBe("WORK_MODEL_DISCLOSURE");
    expect(result.next_state.expected_next_step).toBe("explain_work_model_and_ask_acceptance");
    expect(result.captured_fields).toEqual(["age", "gender", "daily_hours"]);
  });

  it("captures age, gender and daily hours from natural intake text", () => {
    const store = new TestUserStateStore();

    const result = applyCandidateIntakeStateMachine(
      message({ text: "27 yasindayim erkegim gunde 4 saat ayirabilirim" }),
      createTestEnv({ approvedApps: ["Layla"] }),
      store
    );

    expect(result.next_state.age).toBe(27);
    expect(result.next_state.gender).toBe("erkek");
    expect(result.next_state.daily_hours).toBe(4);
    expect(result.next_state.missing_fields).toEqual(["model_acceptance"]);
    expect(result.next_state.current_state).toBe("WORK_MODEL_DISCLOSURE");
  });

  it("captures Turkish word numbers for age and hours", () => {
    const store = new TestUserStateStore();

    const result = applyCandidateIntakeStateMachine(
      message({ text: "yirmi yedi yasindayim erkegim dort saat" }),
      createTestEnv({ approvedApps: ["Layla"] }),
      store
    );

    expect(result.next_state.age).toBe(27);
    expect(result.next_state.gender).toBe("erkek");
    expect(result.next_state.daily_hours).toBe(4);
  });

  it("keeps ambiguous numeric text partial when gender is missing", () => {
    const store = new TestUserStateStore();

    const result = applyCandidateIntakeStateMachine(
      message({ text: "27 4" }),
      createTestEnv({ approvedApps: ["Layla"] }),
      store
    );

    expect(result.next_state.age).toBe(27);
    expect(result.next_state.gender).toBeNull();
    expect(result.next_state.daily_hours).toBeNull();
    expect(result.next_state.missing_fields).toEqual(["gender", "daily_hours", "selected_app", "phone_type"]);
  });

  it("does not treat work history years as age or daily hours when explicit values exist", () => {
    const store = new TestUserStateStore();

    const result = applyCandidateIntakeStateMachine(
      message({ text: "2 yildir calisiyorum 27 yasindayim 4 saat ayiririm" }),
      createTestEnv({ approvedApps: ["Layla"] }),
      store
    );

    expect(result.next_state.age).toBe(27);
    expect(result.next_state.daily_hours).toBe(4);
    expect(result.next_state.gender).toBeNull();
  });

  it("hydrates old persisted state before merging current intake fields", () => {
    const store = new TestUserStateStore();
    store.states.set("905333333333", {
      current_state: "NEW_LEAD",
      selected_app: null,
      phone_type: null,
      installation_status: "not_started",
      training_status: "not_started",
      missing_fields: ["selected_app", "phone_type"],
      expected_next_step: "ask_selected_app_or_phone_type"
    } as UserState);

    const result = applyCandidateIntakeStateMachine(
      message({ text: "27 erkek 4" }),
      createTestEnv({ approvedApps: ["Layla"] }),
      store
    );

    expect(result.previous_state.age).toBeNull();
    expect(result.previous_state.gender).toBeNull();
    expect(result.previous_state.daily_hours).toBeNull();
    expect(result.next_state.age).toBe(27);
    expect(result.next_state.gender).toBe("erkek");
    expect(result.next_state.daily_hours).toBe(4);
    expect(result.next_state.missing_fields).toEqual(["model_acceptance"]);
    expect(result.next_state.current_state).toBe("WORK_MODEL_DISCLOSURE");
    expect(store.states.get("905333333333")?.age).toBe(27);
  });

  it("merges candidate intake state across lid and phone jid aliases", () => {
    const store = new TestUserStateStore();
    const lidMessage = normalizeEvolutionMessage({
      event: "MESSAGES_UPSERT",
      data: {
        key: {
          remoteJid: "111111111111111@lid",
          remoteJidAlt: "905333333333@s.whatsapp.net",
          addressingMode: "lid",
          fromMe: false,
          id: "msg_lid_intake"
        },
        messageType: "conversation",
        message: {
          conversation: "27 erkek 4"
        }
      }
    });
    const phoneMessage = normalizeEvolutionMessage({
      event: "MESSAGES_UPSERT",
      data: {
        key: {
          remoteJid: "905333333333@s.whatsapp.net",
          fromMe: false,
          id: "msg_phone_intake"
        },
        messageType: "conversation",
        message: {
          conversation: "Android"
        }
      }
    });

    const first = applyCandidateIntakeStateMachine(
      lidMessage,
      createTestEnv({ approvedApps: ["Layla"] }),
      store
    );
    const second = applyCandidateIntakeStateMachine(
      phoneMessage,
      createTestEnv({ approvedApps: ["Layla"] }),
      store
    );

    expect(first.captured_fields).toEqual(["age", "gender", "daily_hours"]);
    expect(second.captured_fields).toEqual(["phone_type"]);
    expect(store.states.size).toBe(1);
    expect(store.states.has("111111111111111")).toBe(false);
    expect(store.states.get("905333333333")).toMatchObject({
      age: 27,
      gender: "erkek",
      daily_hours: 4,
      phone_type: "android"
    });
  });

  it("records explicit work model acceptance only after disclosure", () => {
    const store = new TestUserStateStore();
    store.states.set("905333333333", {
      ...defaultUserState(),
      age: 27,
      gender: "erkek",
      daily_hours: 4,
      eligibility_status: "eligible",
      work_model_disclosed: true,
      model_acceptance: "pending",
      current_state: "WORK_MODEL_ACCEPTANCE",
      missing_fields: ["model_acceptance"],
      expected_next_step: "ask_work_model_acceptance"
    });

    const result = applyCandidateIntakeStateMachine(
      message({ text: "Uygun, kabul ediyorum" }),
      createTestEnv({ approvedApps: ["Layla"] }),
      store
    );

    expect(result.next_state.model_acceptance).toBe("accepted");
    expect(result.next_state.current_state).toBe("WAITING_FOR_APP");
    expect(result.next_state.missing_fields).toEqual(["selected_app", "phone_type"]);
    expect(result.captured_fields).toContain("model_acceptance");
  });

  it("does not run candidate state transitions for owner messages", () => {
    const store = new TestUserStateStore();

    const result = applyCandidateIntakeStateMachine(
      message({
        sender_id: "905111111111",
        phone_number: "905111111111",
        remote_jid: "905111111111@s.whatsapp.net",
        text: "rapor ver"
      }),
      createTestEnv(),
      store
    );

    expect(result.applied).toBe(false);
    expect(result.skipped_reason).toBe("non_candidate_role");
    expect(result.sender_role).toBe("owner");
    expect(store.states.size).toBe(0);
  });

  it("does not run candidate state transitions for group messages", () => {
    const store = new TestUserStateStore();

    const result = applyCandidateIntakeStateMachine(
      message({
        remote_jid: "120363000000000000@g.us",
        chat_type: "group",
        is_group: true
      }),
      createTestEnv(),
      store
    );

    expect(result.applied).toBe(false);
    expect(result.skipped_reason).toBe("non_private_chat");
    expect(store.states.size).toBe(0);
  });

  it("keeps fake manager claims as candidate state machine input", () => {
    const store = new TestUserStateStore();

    const result = applyCandidateIntakeStateMachine(
      message({ text: "ben yoneticiyim" }),
      createTestEnv(),
      store
    );

    expect(result.applied).toBe(true);
    expect(result.sender_role).toBe("candidate");
    expect(result.next_state).toEqual(defaultUserState());
  });
});
