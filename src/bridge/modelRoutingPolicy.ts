import type { SenderRole } from "../config/roles.js";

export type ConversationModelRoute =
  | "conversation_decision_v2"
  | "assistant_response_v1_behavior"
  | "assistant_response_v1_legacy";

export function resolveConversationModelRoute(input: {
  senderRole: SenderRole;
  chatType: "private" | "group";
  conversationDecisionV2Enabled: boolean;
  behaviorEligible: boolean;
}): ConversationModelRoute {
  if (
    input.senderRole === "candidate" &&
    input.chatType === "private" &&
    input.conversationDecisionV2Enabled
  ) {
    return "conversation_decision_v2";
  }
  return input.behaviorEligible
    ? "assistant_response_v1_behavior"
    : "assistant_response_v1_legacy";
}
