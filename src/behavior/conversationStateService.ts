import type { BackendContextPayloadV1 } from "../contracts/backendContextPayload.js";
import { defaultUserState, type UserIdentityInput, type UserState, type UserStateStore } from "../storage/types.js";
import { applyUserStateTransition } from "../storage/userStateTransitionBoundary.js";
import type {
  AssistantAction,
  ConversationState,
  ResponsePlan,
  UserIntent,
  UserStage,
} from "./types.js";

const MAX_SUMMARY_CHARS = 700;
const MAX_TOPIC_COUNT = 8;
const MAX_OBJECTION_COUNT = 5;

export interface ConversationStateLoadInput {
  backendContext: BackendContextPayloadV1;
  conversationKey: string;
  userStateStore?: UserStateStore;
}

export interface StateTransitionProposal {
  nextUserStage: UserStage;
  lastResolvedIntent: UserIntent | null;
  unresolvedObjections: string[];
  completedTopics: string[];
  pendingTopics: string[];
  lastAssistantAction: AssistantAction;
  lastUserSentiment: ConversationState["lastUserSentiment"];
  escalationStatus: ConversationState["escalationStatus"];
  summary: string;
  textOnlyPreference: boolean;
  preferredWorkMode: ConversationState["preferredWorkMode"];
  videoAllowed: boolean;
  clearReadySignal: boolean;
  clearActiveSignal: boolean;
  inactiveSignal: boolean;
  confidenceOnly: boolean;
}

export interface StateTransitionResult {
  ok: boolean;
  current: ConversationState;
  next: ConversationState;
  rejected_reason?: string;
}

function normalize(text: string): string {
  return text
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "");
}

export function sanitizeSummary(summary: string): string {
  return summary
    .replace(/[A-Za-z0-9._%+-]+@(s\.whatsapp\.net|g\.us)\b/gi, "[masked_jid]")
    .replace(/\b\d+@g\.us\b/gi, "[masked_group]")
    .replace(/\b\d{10,15}\b/g, "[masked_phone]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[masked_secret]")
    .replace(/\b(api[_-]?key|token|secret)\s*[:=]\s*\S+/gi, "$1=[masked_secret]")
    .replace(/internal_boss_note/gi, "[internal_note]")
    .replace(/system prompt/gi, "[internal_prompt]")
    .slice(0, MAX_SUMMARY_CHARS)
    .trim();
}

function uniqLimit(values: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = sanitizeSummary(value).trim();
    const key = clean.toLocaleLowerCase("tr-TR");
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= max) break;
  }
  return out;
}

function inferStageFromBackend(context: BackendContextPayloadV1): UserStage {
  if (context.sender_role === "owner" || context.sender_role === "manager") return "active";
  if (context.chat_type === "group") return "unknown";
  if (context.state.current_state === "READY_FOR_INSTALLATION") return "ready";
  if (context.state.current_state === "INSTALLATION_IN_PROGRESS") return "active";
  if (context.state.current_state === "SUPPORT_NEEDED") return "needs_support";
  if (context.state.selected_app || context.state.phone_type) return "interested";
  if (context.memory.last_10_messages.length > 0) return "exploring";
  return "new";
}

function inferIntentFromText(text: string, answerIntent?: string | null): UserIntent | null {
  const normalized = normalize(text);
  if (/(takildim|takildım|yapamadim|olmuyor|hata|destek)/u.test(normalized)) return "support_request";
  if (/(guven|guvenli|dolandir|suphe|risk|odeme|para)/u.test(normalized)) return "hesitation";
  if (/(sikayet|kotu|istemiyorum)/u.test(normalized)) return "complaint";
  if (/(baslayalim|hazirim|kuruluma gec|tamam basla)/u.test(normalized)) return "ready_to_start";
  if (/^(selam|merhaba|tamam|ok|tesekkur)/u.test(normalized)) return "casual_message";
  if (answerIntent && answerIntent !== "unknown") return "question";
  return null;
}

function sentimentFromText(text: string): ConversationState["lastUserSentiment"] {
  const normalized = normalize(text);
  if (/(takildim|yapamadim|olmuyor|hata|kizdim|sinir)/u.test(normalized)) return "frustrated";
  if (/(guven|dolandir|suphe|risk|emin degilim)/u.test(normalized)) return "hesitant";
  if (/(tamam|super|tesekkur|hazirim|baslayalim)/u.test(normalized)) return "positive";
  if (!normalized.trim()) return "unknown";
  return "neutral";
}

function storedToConversationState(stored: UserState["behavior_conversation_state"]): ConversationState | null {
  if (!stored) return null;
  return {
    tenantId: stored.tenantId,
    conversationId: stored.conversationId,
    channelType: stored.channelType,
    currentMode: stored.currentMode,
    userStage: stored.userStage as UserStage,
    lastResolvedIntent: stored.lastResolvedIntent as UserIntent | null,
    unresolvedObjections: uniqLimit(stored.unresolvedObjections, MAX_OBJECTION_COUNT),
    completedTopics: uniqLimit(stored.completedTopics, MAX_TOPIC_COUNT),
    pendingTopics: uniqLimit(stored.pendingTopics, MAX_TOPIC_COUNT),
    lastAssistantAction: stored.lastAssistantAction as AssistantAction,
    lastUserSentiment: stored.lastUserSentiment as ConversationState["lastUserSentiment"],
    escalationStatus: stored.escalationStatus as ConversationState["escalationStatus"],
    summary: sanitizeSummary(stored.summary),
    textOnlyPreference: stored.textOnlyPreference ?? false,
    preferredWorkMode: stored.preferredWorkMode ?? (stored.textOnlyPreference ? "text_only" : "video_or_voice_allowed"),
    videoAllowed: stored.videoAllowed ?? !(stored.textOnlyPreference ?? false),
    updatedAt: stored.updatedAt,
  };
}

function conversationStateToStored(state: ConversationState): NonNullable<UserState["behavior_conversation_state"]> {
  return {
    tenantId: state.tenantId,
    conversationId: state.conversationId,
    channelType: state.channelType,
    currentMode: state.currentMode,
    userStage: state.userStage,
    lastResolvedIntent: state.lastResolvedIntent,
    unresolvedObjections: uniqLimit(state.unresolvedObjections, MAX_OBJECTION_COUNT),
    completedTopics: uniqLimit(state.completedTopics, MAX_TOPIC_COUNT),
    pendingTopics: uniqLimit(state.pendingTopics, MAX_TOPIC_COUNT),
    lastAssistantAction: state.lastAssistantAction,
    lastUserSentiment: state.lastUserSentiment,
    escalationStatus: state.escalationStatus,
    summary: sanitizeSummary(state.summary),
    textOnlyPreference: state.textOnlyPreference,
    preferredWorkMode: state.preferredWorkMode ?? (state.textOnlyPreference ? "text_only" : "video_or_voice_allowed"),
    videoAllowed: state.videoAllowed ?? !state.textOnlyPreference,
    updatedAt: state.updatedAt,
  };
}

export class ConversationStateService {
  constructor(
    private readonly userStateStore?: UserStateStore,
    private readonly identity?: UserIdentityInput,
  ) {}

  load(input: ConversationStateLoadInput): ConversationState {
    const stored = this.userStateStore
      ?.getOrCreateState(input.conversationKey, defaultUserState(), this.identity)
      .behavior_conversation_state;
    const fromStore = storedToConversationState(stored);
    if (fromStore) return this.buildSafeSnapshot(fromStore);

    return this.buildSafeSnapshot({
      tenantId: "now_os",
      conversationId: input.backendContext.correlation_id,
      channelType: input.backendContext.chat_type,
      currentMode: input.backendContext.answer_plan?.mode ?? (input.backendContext.chat_type === "group" ? "group_mode" : "conversation_mode"),
      userStage: inferStageFromBackend(input.backendContext),
      lastResolvedIntent: inferIntentFromText("", input.backendContext.answer_plan?.intent),
      unresolvedObjections: [],
      completedTopics: input.backendContext.state.missing_fields.length === 0 ? ["candidate_required_fields"] : [],
      pendingTopics: input.backendContext.state.missing_fields,
      lastAssistantAction: "none",
      lastUserSentiment: "unknown",
      escalationStatus: input.backendContext.answer_plan?.escalation_required ? "required" : "none",
      summary: input.backendContext.memory.summary ?? input.backendContext.memory.conversation_summary,
      textOnlyPreference: false,
      preferredWorkMode: "video_or_voice_allowed",
      videoAllowed: true,
      updatedAt: new Date().toISOString(),
    });
  }

  buildSafeSnapshot(state: ConversationState): ConversationState {
    return {
      ...state,
      unresolvedObjections: uniqLimit(state.unresolvedObjections, MAX_OBJECTION_COUNT),
      completedTopics: uniqLimit(state.completedTopics, MAX_TOPIC_COUNT),
      pendingTopics: uniqLimit(state.pendingTopics, MAX_TOPIC_COUNT),
      summary: sanitizeSummary(state.summary),
    };
  }

  proposeTransition(
    current: ConversationState,
    _assistantResponse: { reply: string; internal_boss_note: string },
    responsePlan: ResponsePlan,
    userMessage: string,
  ): StateTransitionProposal {
    const normalized = normalize(userMessage);
    const intent = inferIntentFromText(userMessage, null) ?? current.lastResolvedIntent;
    const sentiment = sentimentFromText(userMessage);
    const supportSignal = intent === "support_request";
    const objectionSignal = intent === "hesitation" || sentiment === "hesitant";
    const clearReadySignal = /(baslayalim|hazirim|kuruluma gec|tamam basla|devam edelim)/u.test(normalized);
    const clearActiveSignal = /(kurdum|giris yaptim|basladim|aktifim|egitime basladim)/u.test(normalized);
    const inactiveSignal = /(birakiyorum|istemiyorum|iptal|vazgectim)/u.test(normalized);
    const textOnlySignal = /(yazili|sadece mesaj|goruntulu gorusme (istemiyorum|zorunlu mu|yok))/u.test(normalized);

    let nextUserStage = current.userStage;
    if (supportSignal && current.userStage === "active") nextUserStage = "needs_support";
    else if (clearActiveSignal && current.userStage === "ready") nextUserStage = "active";
    else if (clearReadySignal && current.userStage === "hesitant") nextUserStage = "ready";
    else if (objectionSignal && (current.userStage === "interested" || current.userStage === "exploring")) nextUserStage = "hesitant";
    else if (current.userStage === "exploring" && responsePlan.objective !== "ignore") nextUserStage = "interested";
    else if (current.userStage === "new" && responsePlan.objective !== "ignore") nextUserStage = "exploring";

    const completed = [...current.completedTopics];
    if (intent && intent !== "unknown") completed.push(intent);

    const pending = current.pendingTopics.filter((topic) => !completed.includes(topic));
    const objections = objectionSignal
      ? [...current.unresolvedObjections, "trust_or_payment_hesitation"]
      : current.unresolvedObjections;

    return {
      nextUserStage,
      lastResolvedIntent: intent,
      unresolvedObjections: uniqLimit(objections, MAX_OBJECTION_COUNT),
      completedTopics: uniqLimit(completed, MAX_TOPIC_COUNT),
      pendingTopics: uniqLimit(pending, MAX_TOPIC_COUNT),
      lastAssistantAction: responsePlan.mayAskQuestion ? "ask_question" : responsePlan.objective === "ignore" ? "none" : "provide_guidance",
      lastUserSentiment: sentiment,
      escalationStatus: responsePlan.objective === "escalate" ? "required" : current.escalationStatus,
      summary: sanitizeSummary(
        `Stage ${nextUserStage}. Last intent ${intent ?? "unknown"}. Pending ${pending.join(", ") || "none"}.`,
      ),
      textOnlyPreference: current.textOnlyPreference || textOnlySignal,
      preferredWorkMode: current.textOnlyPreference || textOnlySignal ? "text_only" : "video_or_voice_allowed",
      videoAllowed: !(current.textOnlyPreference || textOnlySignal),
      clearReadySignal,
      clearActiveSignal,
      inactiveSignal,
      confidenceOnly: false,
    };
  }

  validateTransition(current: ConversationState, proposal: StateTransitionProposal): StateTransitionResult {
    if (proposal.confidenceOnly) {
      return this.reject(current, proposal, "confidence_alone_transition_rejected");
    }
    if (current.userStage === "new" && proposal.nextUserStage === "active") {
      return this.reject(current, proposal, "new_to_active_rejected");
    }
    if (current.userStage === "unknown" && proposal.nextUserStage === "ready" && !proposal.clearReadySignal) {
      return this.reject(current, proposal, "unknown_to_ready_without_clear_signal");
    }
    if (current.userStage === "hesitant" && proposal.nextUserStage === "ready" && !proposal.clearReadySignal) {
      return this.reject(current, proposal, "hesitant_to_ready_requires_clear_signal");
    }
    if (current.userStage === "active" && proposal.nextUserStage === "inactive" && proposal.inactiveSignal) {
      return this.reject(current, proposal, "active_to_inactive_single_message_rejected");
    }
    if (current.escalationStatus === "required" && proposal.escalationStatus === "resolved") {
      return this.reject(current, proposal, "normal_user_cannot_complete_escalation");
    }

    const next = this.buildSafeSnapshot({
      ...current,
      userStage: proposal.nextUserStage,
      lastResolvedIntent: proposal.lastResolvedIntent,
      unresolvedObjections: proposal.unresolvedObjections,
      completedTopics: proposal.completedTopics,
      pendingTopics: proposal.pendingTopics,
      lastAssistantAction: proposal.lastAssistantAction,
      lastUserSentiment: proposal.lastUserSentiment,
      escalationStatus: proposal.escalationStatus,
      summary: proposal.summary,
      textOnlyPreference: proposal.textOnlyPreference,
      preferredWorkMode: proposal.preferredWorkMode,
      videoAllowed: proposal.videoAllowed,
      updatedAt: new Date().toISOString(),
    });
    return { ok: true, current, next };
  }

  applyTransition(result: StateTransitionResult, conversationKey: string): ConversationState {
    if (!result.ok || !this.userStateStore) return result.current;
    const currentUserState = this.userStateStore.getOrCreateState(conversationKey, defaultUserState(), this.identity);
    applyUserStateTransition({
      store: this.userStateStore,
      conversationKey,
      currentState: currentUserState,
      nextState: {
        ...currentUserState,
        behavior_conversation_state: conversationStateToStored(result.next),
      },
      source: "behavior_transition",
      identity: this.identity,
    });
    return result.next;
  }

  private reject(
    current: ConversationState,
    proposal: StateTransitionProposal,
    rejectedReason: string,
  ): StateTransitionResult {
    return {
      ok: false,
      current,
      next: this.buildSafeSnapshot({
        ...current,
        lastResolvedIntent: proposal.lastResolvedIntent,
        unresolvedObjections: proposal.unresolvedObjections,
        completedTopics: proposal.completedTopics,
        pendingTopics: proposal.pendingTopics,
        lastAssistantAction: proposal.lastAssistantAction,
        lastUserSentiment: proposal.lastUserSentiment,
        escalationStatus: proposal.escalationStatus,
        summary: proposal.summary,
        textOnlyPreference: current.textOnlyPreference,
        preferredWorkMode: current.preferredWorkMode ?? (current.textOnlyPreference ? "text_only" : "video_or_voice_allowed"),
        videoAllowed: current.videoAllowed ?? !current.textOnlyPreference,
        updatedAt: new Date().toISOString(),
      }),
      rejected_reason: rejectedReason,
    };
  }
}
