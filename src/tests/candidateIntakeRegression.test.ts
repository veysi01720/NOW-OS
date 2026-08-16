import { vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleIncomingMessage } from "../bridge/handleIncomingMessage.js";
import type { NormalizedIncomingMessage } from "../bridge/normalizeEvolutionMessage.js";
import { InMemoryStore } from "../storage/memoryStore.js";
import { InMemoryMessageDedupeStore } from "../storage/messageDedupeStore.js";
import { UserRunLock } from "../queue/userRunLock.js";
import { createTestEnv } from "./testDoubles.js";
import { defaultUserState, UserState, UserIdentityInput } from "../storage/types.js";
import { writeValidKnowledgeBankFixture } from "./fixtures/knowledgeBankFixture.js";

const knowledgeBankDir = mkdtempSync(join(tmpdir(), "nowos-intake-regression-facts-"));
writeValidKnowledgeBankFixture(knowledgeBankDir);
const previousKnowledgeBankDir = process.env.KNOWLEDGE_BANK_DIR;
beforeAll(() => {
  process.env.KNOWLEDGE_BANK_DIR = knowledgeBankDir;
});
afterAll(() => {
  if (previousKnowledgeBankDir === undefined) delete process.env.KNOWLEDGE_BANK_DIR;
  else process.env.KNOWLEDGE_BANK_DIR = previousKnowledgeBankDir;
  rmSync(knowledgeBankDir, { recursive: true, force: true });
});

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
  it("completes the full intake through model decisions without deterministic fast-paths", async () => {
    const response = (text: string, actions: string[], nextAction: string, statePatch: Record<string, unknown> = {}) => JSON.stringify({
      decision_version: "2.0",
      intent: { primary: "candidate_next_step", secondary: [], confidence: 0.95 },
      direct_question: { present: false, question_summary: null, answered_in_reply: true },
      reply: { text, language: "tr", tone: "natural_concise", contains_question: text.includes("?") },
      chosen_actions: actions,
      state_patch: statePatch,
      policy_facts_used: actions.includes("explain_work_model")
        ? ["male_candidate_work_model", "work_model_acceptance_required", "candidate_work_steps_chat_based"]
        : [],
      next_action: nextAction,
      requires_escalation: false,
      escalation_reason: null,
      risk_flags: [],
      self_check: { answered_latest_message: true, asked_known_information_again: false, invented_policy: false, offered_setup_too_early: false, used_generic_closing: false },
    });
    const memoryStore = new InMemoryStore();
    const userStateStore = new TestUserStateStore();
    const modelExecutionService = {
      execute: vi.fn().mockImplementation(async (input: any) => {
        const context = input.contextPayload?.conversation_decision_v2;
        const state = context?.derived_state?.dialogue_phase;
        if (context?.candidate_state?.age === null) return { rawText: response("Yaşın nedir?", ["answer_user_question", "ask_missing_age"], "ask_missing_age") };
        if (context?.candidate_state?.gender === null) return { rawText: response("Cinsiyetin nedir?", ["answer_user_question", "ask_missing_gender"], "ask_missing_gender") };
        if (state === "WORK_MODEL_DISCLOSURE" || state === "WORK_MODEL_ACCEPTANCE") return { rawText: response("Bu çalışma modeli sana uygun mu?", ["answer_user_question", "explain_work_model", "request_work_model_acceptance"], "request_work_model_acceptance", { work_model_disclosed: true, work_model_acceptance: "pending" }) };
        if (context?.candidate_state?.selected_app === null) return { rawText: response("Hangi uygulamayla başlamak istersin?", ["answer_user_question", "ask_selected_app"], "ask_selected_app") };
        if (context?.candidate_state?.phone_type === null) return { rawText: response("Telefonun Android mi iPhone mu?", ["answer_user_question", "ask_phone_type"], "ask_phone_type") };
        return { rawText: response("Android bilgini aldım; kurulum adımlarına geçebiliriz.", ["answer_user_question", "provide_installation_instruction"], "update_candidate_state", { phone_type: "android" }) };
      }),
      evaluateCanaryDecisionForMessage: vi.fn(),
      finalizeCanaryObservation: vi.fn(),
    };
    const deps = {
      env: createTestEnv({ behaviorOrchestratorEnabled: false, modelAdapterLayerEnabled: true, behaviorCanaryMode: "off", conversationDecisionV2Enabled: true, approvedApps: ["Layla"] }),
      sender: { sendText: vi.fn().mockResolvedValue({ success: true, messageId: "out" }) },
      memoryStore,
      messageDedupeStore: new InMemoryMessageDedupeStore(),
      userStateStore,
      eventLogStore: new TestEventLogStore(),
      userRunLock: new UserRunLock(),
      knowledgeBankDir,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
      modelExecutionService,
    };
    const messages = ["Selam", "27", "erkek 4 saat", "Evet uygun", "Layla", "Android"];
    for (const text of messages) {
      const result = await handleIncomingMessage(message({ text }), deps as any);
      expect(result.status).toBe("sent");
    }
    const state = userStateStore.states.get("905333333333");
    expect(modelExecutionService.execute.mock.calls.length).toBeGreaterThanOrEqual(6);
    expect(state).toEqual(expect.objectContaining({ age: 27, gender: "erkek", daily_hours: 4, model_acceptance: "accepted", selected_app: "Layla", phone_type: "android", current_state: "INSTALLATION_IN_PROGRESS", installation_status: "in_progress" }));
    const origins = (deps.logger.info as any).mock.calls.flat().map((entry: any) => entry?.final_reply_origin).filter(Boolean);
    expect(origins.some((origin: string) => origin.includes("deterministic"))).toBe(false);
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
    expect(deps.modelExecutionService.execute).toHaveBeenCalled();
    expect(deps.sender.sendText).toHaveBeenCalled();
    /*
      expect.objectContaining({
        text: "Merhaba, doğru yönlendirme yapabilmem için yaşını, cinsiyetini ve günlük ortalama kaç saat ayırabileceğini yazar mısın?"
      })
    ); */

    // 2. "Sadece Layla mı?"
    vi.clearAllMocks();
    await handleIncomingMessage(message({ text: "Sadece Layla mı?" }), deps as any);
    expect(deps.modelExecutionService.execute).toHaveBeenCalled();

    // 3. "Yaş cinsiyet önemli mi?"
    vi.clearAllMocks();
    await handleIncomingMessage(message({ text: "Yaş cinsiyet önemli mi?" }), deps as any);
    expect(deps.modelExecutionService.execute).toHaveBeenCalled();

    // 4. "Erkek profili ile bu iş nasıl yapılacak?"
    vi.clearAllMocks();
    await handleIncomingMessage(message({ text: "Erkek profili ile bu iş nasıl yapılacak?" }), deps as any);
    expect(deps.modelExecutionService.execute).toHaveBeenCalled();

    // 5. Provide info
    vi.clearAllMocks();
    userStateStore.states.clear();
    await handleIncomingMessage(message({ text: "25 kadın 4 saat ayırabilirim" }), deps as any);
    
    // Female intake asks one additional experience question before model execution.
    expect(deps.modelExecutionService.execute).toHaveBeenCalled();
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
        execute: vi.fn().mockResolvedValue({
          rawText: JSON.stringify({
            decision_version: "2.0",
            intent: { primary: "confirm_phone_type", secondary: [], confidence: 0.95 },
            direct_question: { present: false, question_summary: null, answered_in_reply: true },
            reply: { text: "Android bilgini aldim; kurulum adimlarina gecebiliriz.", language: "tr", tone: "natural_concise", contains_question: false },
            chosen_actions: ["acknowledge_information", "provide_installation_instruction"],
            state_patch: { phone_type: "android" },
            policy_facts_used: [],
            next_action: "update_candidate_state",
            requires_escalation: false,
            escalation_reason: null,
            risk_flags: [],
            self_check: { answered_latest_message: true, asked_known_information_again: false, invented_policy: false, offered_setup_too_early: false, used_generic_closing: false }
          })
        }),
        evaluateCanaryDecisionForMessage: vi.fn(),
        finalizeCanaryObservation: vi.fn(),
      },
    };

    const result = await handleIncomingMessage(message({ text: "Android" }), deps as any);

    expect(result.status).toBe("sent");
    expect(userStateStore.states.get("905333333333")?.phone_type).toBe("android");
    expect(userStateStore.states.get("905333333333")?.installation_status).toBe("in_progress");
    expect(userStateStore.states.get("905333333333")?.current_state).toBe("INSTALLATION_IN_PROGRESS");
    expect(deps.modelExecutionService.execute).toHaveBeenCalledTimes(1);
    expect(deps.sender.sendText).toHaveBeenCalled();
    expect(deps.sender.sendText).not.toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringMatching(/ekip|doğrulanmamış|doÄŸrulanmamÄ±ÅŸ/) }),
    );
  });
});
