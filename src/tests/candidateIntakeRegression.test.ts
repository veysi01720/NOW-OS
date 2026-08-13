import { vi } from "vitest";
import { handleIncomingMessage } from "../bridge/handleIncomingMessage.js";
import type { NormalizedIncomingMessage } from "../bridge/normalizeEvolutionMessage.js";
import { InMemoryStore } from "../storage/memoryStore.js";
import { InMemoryMessageDedupeStore } from "../storage/messageDedupeStore.js";
import { UserRunLock } from "../queue/userRunLock.js";
import { createTestEnv } from "./testDoubles.js";
import { defaultUserState, UserState, UserIdentityInput } from "../storage/types.js";
import { applyCandidateIntakeStateMachine } from "../bridge/candidateIntakeStateMachine.js";
import { buildCandidateIntakeDeterministicReply } from "../bridge/candidateIntakeDeterministicReply.js";

class TestUserStateStore {
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

class TestEventLogStore {
  recordEvent() {}
}

const env = createTestEnv({
  behaviorOrchestratorEnabled: true,
  modelAdapterLayerEnabled: true,
  behaviorCanaryMode: "off"
});

function message(overrides: Partial<NormalizedIncomingMessage> = {}): NormalizedIncomingMessage {
  return {
    correlation_id: `corr_${Math.random()}`,
    sender_id: "905333333333",
    phone_number: "905333333333",
    remote_jid: "905333333333@s.whatsapp.net",
    message_id: `msg_${Math.random()}`,
    message_type: "conversation",
    text: "",
    chat_type: "private",
    is_from_me: false,
    is_group: false,
    received_at: new Date().toISOString(),
    ...overrides
  };
}

describe("Candidate Intake Regression Fixture", () => {
  it("runs the complete intake contract without delegating simple transitions to the model", () => {
    const store = new TestUserStateStore();
    const intakeEnv = createTestEnv({ approvedApps: ["Layla"] });

    const run = (text: string) => applyCandidateIntakeStateMachine(
      message({ text }),
      intakeEnv,
      store,
    );

    const greeting = run("Selam");
    expect(greeting.next_state.current_state).toBe("NEW_LEAD");
    expect(buildCandidateIntakeDeterministicReply(greeting)).toBeNull();

    const age = run("27");
    expect(age.next_state.age).toBe(27);
    expect(buildCandidateIntakeDeterministicReply(age)).toMatchObject({
      origin: "deterministic_partial_intake_fast_path",
      chosen_actions: ["acknowledge_information", "ask_missing_gender"],
      next_action: "ask_missing_info",
      text: expect.stringContaining("Cinsiyetin nedir?"),
    });

    const core = run("erkek 4 saat");
    expect(core.next_state.current_state).toBe("WORK_MODEL_DISCLOSURE");
    expect(buildCandidateIntakeDeterministicReply(core)).toBeNull();

    // Work-model explanation is the only model-owned checkpoint in this path.
    store.updateState("905333333333", {
      ...core.next_state,
      work_model_disclosed: true,
      model_acceptance: "pending",
      current_state: "WORK_MODEL_ACCEPTANCE",
      missing_fields: ["model_acceptance"],
      expected_next_step: "ask_work_model_acceptance",
    });

    const acceptance = run("Evet uygun");
    expect(acceptance.next_state.current_state).toBe("WAITING_FOR_APP");
    expect(buildCandidateIntakeDeterministicReply(acceptance)).toMatchObject({
      origin: "deterministic_model_acceptance_fast_path",
      chosen_actions: ["acknowledge_information", "record_work_model_acceptance", "ask_selected_app", "ask_phone_type"],
      next_action: "update_candidate_state",
      text: expect.stringContaining("Hangi onayli uygulama"),
    });

    const app = run("Layla");
    expect(app.next_state.current_state).toBe("WAITING_FOR_PHONE_TYPE");
    expect(buildCandidateIntakeDeterministicReply(app)).toMatchObject({
      origin: "deterministic_app_selection_fast_path",
      chosen_actions: ["acknowledge_information", "ask_phone_type"],
      next_action: "ask_missing_info",
      text: expect.stringContaining("Telefonun Android mi, iPhone mu"),
    });

    const phone = run("Android");
    expect(phone.next_state.current_state).toBe("INSTALLATION_IN_PROGRESS");
    expect(phone.next_state.installation_status).toBe("in_progress");
    expect(buildCandidateIntakeDeterministicReply(phone)).toMatchObject({
      origin: "deterministic_installation_start_fast_path",
      chosen_actions: ["acknowledge_information", "begin_setup", "provide_installation_instruction"],
      next_action: "update_candidate_state",
      text: expect.stringContaining("Kurulum adimlarina"),
    });
  });

  it("forces candidate to provide age, gender and daily time before progressing", async () => {
    const memoryStore = new InMemoryStore();
    const userStateStore = new TestUserStateStore();
    const eventLogStore = new TestEventLogStore();
    const deps = {
      env,
      sender: {
        sendText: vi.fn().mockResolvedValue({ success: true, messageId: "msg_out" })
      },
      memoryStore,
      messageDedupeStore: new InMemoryMessageDedupeStore(),
      userStateStore,
      eventLogStore,
      userRunLock: new UserRunLock(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
      modelExecutionService: {
        execute: vi.fn().mockResolvedValue({ rawText: '{"contract_version":"1.0","reply":"Test","internal_boss_note":""}' }),
        evaluateCanaryDecisionForMessage: vi.fn(),
        finalizeCanaryObservation: vi.fn()
      } as any
    };

    // 1. "Selam / İş nedir?"
    await handleIncomingMessage(message({ text: "Selam / İş nedir?" }), deps as any);
    
    // Model call blocked, intake reply sent
    expect(deps.modelExecutionService.execute).not.toHaveBeenCalled();
    expect(deps.sender.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Merhaba, doğru yönlendirme yapabilmem için yaşını, cinsiyetini ve günlük ortalama kaç saat ayırabileceğini yazar mısın?"
      })
    );

    // 2. "Sadece Layla mı?"
    vi.clearAllMocks();
    await handleIncomingMessage(message({ text: "Sadece Layla mı?" }), deps as any);
    expect(deps.modelExecutionService.execute).not.toHaveBeenCalled();

    // 3. "Yaş cinsiyet önemli mi?"
    vi.clearAllMocks();
    await handleIncomingMessage(message({ text: "Yaş cinsiyet önemli mi?" }), deps as any);
    expect(deps.modelExecutionService.execute).not.toHaveBeenCalled();

    // 4. "Erkek profili ile bu iş nasıl yapılacak?"
    vi.clearAllMocks();
    await handleIncomingMessage(message({ text: "Erkek profili ile bu iş nasıl yapılacak?" }), deps as any);
    expect(deps.modelExecutionService.execute).not.toHaveBeenCalled();

    // 5. Provide info
    vi.clearAllMocks();
    userStateStore.states.clear();
    await handleIncomingMessage(message({ text: "25 kadın 4 saat ayırabilirim" }), deps as any);
    
    // Female intake asks one additional experience question before model execution.
    expect(deps.modelExecutionService.execute).not.toHaveBeenCalled();
    await handleIncomingMessage(message({ text: "Daha once deneyimim yok" }), deps as any);

    // Now model execution should happen.
    expect(deps.modelExecutionService.execute).toHaveBeenCalled();
  });

  it("records Layla + Android through the V3 transition without the fallback", async () => {
    const memoryStore = new InMemoryStore();
    const userStateStore = new TestUserStateStore();
    userStateStore.states.set("905333333333", {
      ...defaultUserState(),
      age: 27,
      gender: "erkek",
      daily_hours: 4,
      eligibility_status: "eligible",
      work_model_disclosed: true,
      model_acceptance: "accepted",
      selected_app: "Layla",
      current_state: "WAITING_FOR_PHONE_TYPE",
      missing_fields: ["phone_type"],
      expected_next_step: "ask_phone_type",
    });
    const deps = {
      env: createTestEnv({
        behaviorOrchestratorEnabled: false,
        modelAdapterLayerEnabled: true,
        behaviorCanaryMode: "off",
        conversationDecisionV2Enabled: true,
        approvedApps: ["Layla"],
      }),
      sender: { sendText: vi.fn().mockResolvedValue({ success: true, messageId: "msg_out" }) },
      memoryStore,
      messageDedupeStore: new InMemoryMessageDedupeStore(),
      userStateStore,
      eventLogStore: new TestEventLogStore(),
      userRunLock: new UserRunLock(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
      modelExecutionService: {
        execute: vi.fn().mockRejectedValue(new Error("model should not be called for phone capture")),
        evaluateCanaryDecisionForMessage: vi.fn(),
        finalizeCanaryObservation: vi.fn(),
      },
    };

    const result = await handleIncomingMessage(message({ text: "Android" }), deps as any);

    expect(result.status).toBe("sent");
    expect(userStateStore.states.get("905333333333")?.phone_type).toBe("android");
    expect(userStateStore.states.get("905333333333")?.installation_status).toBe("in_progress");
    expect(userStateStore.states.get("905333333333")?.current_state).toBe("INSTALLATION_IN_PROGRESS");
    expect(deps.modelExecutionService.execute).not.toHaveBeenCalled();
    expect(deps.sender.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("Kurulum adimlarina") }),
    );
    expect(deps.sender.sendText).not.toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringMatching(/ekip|doğrulanmamış|doÄŸrulanmamÄ±ÅŸ/) }),
    );
  });
});
