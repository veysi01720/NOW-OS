import type { AuthorityContext } from "../bridge/authorityContext.js";
import type { UserIdentityInput, UserState, UserStateStore } from "./types.js";

export type UserStateTransitionSource =
  | "candidate_intake"
  | "conversation_decision_v2"
  | "behavior_snapshot"
  | "behavior_transition";

export interface UserStateTransitionResult {
  applied: boolean;
  reason: "applied" | "unchanged" | "missing_store" | "invalid_conversation_key" | "authority_denied";
}

function cloneState(state: UserState): UserState {
  return {
    ...state,
    missing_fields: [...state.missing_fields],
    ...(state.behavior_conversation_state
      ? {
          behavior_conversation_state: {
            ...state.behavior_conversation_state,
            unresolvedObjections: [...state.behavior_conversation_state.unresolvedObjections],
            completedTopics: [...state.behavior_conversation_state.completedTopics],
            pendingTopics: [...state.behavior_conversation_state.pendingTopics],
          },
        }
      : {}),
  };
}

function candidateSource(source: UserStateTransitionSource): boolean {
  return source === "candidate_intake" || source === "conversation_decision_v2";
}

export function applyUserStateTransition(input: {
  store?: UserStateStore;
  conversationKey: string;
  currentState: UserState;
  nextState: UserState;
  source: UserStateTransitionSource;
  identity?: UserIdentityInput;
  authority?: AuthorityContext;
}): UserStateTransitionResult {
  if (!input.store) return { applied: false, reason: "missing_store" };
  if (input.conversationKey.trim() === "") return { applied: false, reason: "invalid_conversation_key" };
  if (
    candidateSource(input.source) &&
    input.authority &&
    (input.authority.sender_role !== "candidate" || input.authority.chat_type !== "private")
  ) {
    return { applied: false, reason: "authority_denied" };
  }

  const current = cloneState(input.currentState);
  const next = cloneState(input.nextState);
  if (JSON.stringify(current) === JSON.stringify(next)) {
    return { applied: false, reason: "unchanged" };
  }

  input.store.updateState(input.conversationKey, next, input.identity);
  return { applied: true, reason: "applied" };
}
