import { describe, expect, it } from "vitest";
import { ConversationStateService, type StateTransitionProposal } from "../behavior/conversationStateService.js";
import type { ConversationState, ResponsePlan } from "../behavior/types.js";
import { buildConversationalQualityContract } from "../behavior/conversationalQuality.js";
import { defaultUserState, type UserState, type UserStateStore } from "../storage/types.js";
import type { BackendContextPayloadV1 } from "../contracts/backendContextPayload.js";

class TestUserStateStore implements UserStateStore {
  public states = new Map<string, UserState>();

  getOrCreateState(userId: string, defaults: UserState): UserState {
    const existing = this.states.get(userId);
    if (existing) return { ...existing, missing_fields: [...existing.missing_fields] };
    const next = { ...defaults, missing_fields: [...defaults.missing_fields] };
    this.states.set(userId, next);
    return next;
  }

  updateState(userId: string, state: UserState): void {
    this.states.set(userId, { ...state, missing_fields: [...state.missing_fields] });
  }
}

function plan(overrides: Partial<ResponsePlan> = {}): ResponsePlan {
  const base = {
    objective: "answer" as const,
    desiredLength: "short" as const,
    mayAskQuestion: true,
    shouldUseKnowledge: true,
    shouldAcknowledgeEmotion: false,
    shouldAvoidRepetition: false,
    forbiddenTopics: [],
    requiresModelCall: true,
  };
  return {
    ...base,
    quality: buildConversationalQualityContract(
      {
        channelType: "private",
        mode: "answer_mode",
        senderRole: "candidate",
        normalizedText: "Layla iPhone adi ne?",
        currentUserStage: "new",
        lastResolvedIntent: null,
        unresolvedObjections: [],
        completedTopics: [],
        pendingTopics: [],
        isGroup: false,
        isAuthorized: false,
        answerPlan: { intent: "normal_chat", source_count: 1 },
      },
      base,
    ),
    ...overrides,
  };
}

function state(stage: ConversationState["userStage"]): ConversationState {
  return {
    tenantId: "now_os",
    conversationId: "corr_state",
    channelType: "private",
    currentMode: "answer_mode",
    userStage: stage,
    lastResolvedIntent: null,
    unresolvedObjections: [],
    completedTopics: [],
    pendingTopics: [],
    lastAssistantAction: "none",
    lastUserSentiment: "neutral",
    escalationStatus: "none",
    summary: "",
    textOnlyPreference: false,
    updatedAt: "2026-07-11T00:00:00.000Z",
  };
}

function context(): BackendContextPayloadV1 {
  return {
    backend_context_version: "1.0",
    correlation_id: "corr_state",
    sender_role: "candidate",
    chat_type: "private",
    sender: { sender_id: "905333333333", phone_number: "905333333333" },
    chat: {
      remote_jid: "905333333333@s.whatsapp.net",
      message_id: "msg_state",
      message_type: "conversation",
      is_from_me: false,
      is_group: false,
    },
    allowed_apps: ["Layla"],
    state: defaultUserState(),
    memory: {
      conversation_summary: "",
      last_5_user_messages: [],
      last_5_bot_replies: [],
      last_10_messages: [],
    },
    versions: {
      assistant_response_contract_version: "1.0",
      system_prompt_version: "1.0.0",
      knowledge_base_version: "2026.07.04",
      backend_context_version: "1.0",
      state_machine_version: "1.0",
    },
    user_message: {
      text: "Merhaba",
      received_at: "2026-07-11T00:00:00.000Z",
    },
  };
}

describe("conversation state service", () => {
  it("loads default backend-owned state and safe snapshot", () => {
    const store = new TestUserStateStore();
    const service = new ConversationStateService(store);
    const loaded = service.load({ backendContext: context(), conversationKey: "user_1" });

    expect(loaded.tenantId).toBe("now_os");
    expect(loaded.userStage).toBe("new");
    expect(loaded.summary).not.toContain("905333333333");
  });

  it("allows new to exploring and exploring to interested", () => {
    const service = new ConversationStateService();
    const first = service.proposeTransition(state("new"), { reply: "ok", internal_boss_note: "" }, plan(), "Merhaba");
    const firstResult = service.validateTransition(state("new"), first);
    expect(firstResult.ok).toBe(true);
    expect(firstResult.next.userStage).toBe("exploring");

    const second = service.proposeTransition(state("exploring"), { reply: "ok", internal_boss_note: "" }, plan(), "Layla hakkinda bilgi");
    const secondResult = service.validateTransition(state("exploring"), second);
    expect(secondResult.ok).toBe(true);
    expect(secondResult.next.userStage).toBe("interested");
  });

  it("requires clear signal for hesitant to ready", () => {
    const service = new ConversationStateService();
    const current = state("hesitant");
    const unclear: StateTransitionProposal = {
      ...service.proposeTransition(current, { reply: "ok", internal_boss_note: "" }, plan(), "emin degilim"),
      nextUserStage: "ready",
      clearReadySignal: false,
    };
    expect(service.validateTransition(current, unclear)).toMatchObject({
      ok: false,
      rejected_reason: "hesitant_to_ready_requires_clear_signal",
    });

    const clear = service.proposeTransition(current, { reply: "ok", internal_boss_note: "" }, plan(), "tamam baslayalim");
    expect(service.validateTransition(current, clear).ok).toBe(true);
  });

  it("rejects unsafe transitions", () => {
    const service = new ConversationStateService();
    expect(
      service.validateTransition(state("new"), {
        ...service.proposeTransition(state("new"), { reply: "ok", internal_boss_note: "" }, plan(), "aktifim"),
        nextUserStage: "active",
      }).rejected_reason,
    ).toBe("new_to_active_rejected");

    expect(
      service.validateTransition(state("active"), {
        ...service.proposeTransition(state("active"), { reply: "ok", internal_boss_note: "" }, plan(), "birakiyorum"),
        nextUserStage: "inactive" as never,
        inactiveSignal: true,
      }).rejected_reason,
    ).toBe("active_to_inactive_single_message_rejected");

    expect(
      service.validateTransition(state("exploring"), {
        ...service.proposeTransition(state("exploring"), { reply: "ok", internal_boss_note: "" }, plan(), "merhaba"),
        confidenceOnly: true,
      }).rejected_reason,
    ).toBe("confidence_alone_transition_rejected");
  });

  it("validates escalation and applies only backend-approved state", () => {
    const store = new TestUserStateStore();
    const service = new ConversationStateService(store);
    const current = state("active");
    const proposal = service.proposeTransition(
      current,
      { reply: "operator aktaralim", internal_boss_note: "operator only" },
      plan({ objective: "escalate" }),
      "yapamadim hata var",
    );
    const result = service.validateTransition(current, proposal);
    const applied = service.applyTransition(result, "user_1");

    expect(result.ok).toBe(true);
    expect(applied.userStage).toBe("needs_support");
    expect(store.states.get("user_1")?.behavior_conversation_state?.escalationStatus).toBe("required");
  });
});
