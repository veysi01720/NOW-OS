export type OwnerCapability =
  | "owner_operational_query"
  | "owner_candidate_relay"
  | "owner_knowledge_publish"
  | "owner_knowledge_rollback"
  | "owner_installation_review";

export interface CapabilityDecision {
  authorized: boolean;
  reason: "authorized" | "role_denied" | "channel_denied";
}

export class CapabilityRegistry {
  authorize(input: { capability: OwnerCapability; senderRole: string; chatType: string }): CapabilityDecision {
    if (input.senderRole !== "owner" && input.senderRole !== "manager") {
      return { authorized: false, reason: "role_denied" };
    }
    if (input.chatType !== "private") return { authorized: false, reason: "channel_denied" };
    return { authorized: true, reason: "authorized" };
  }
}

export function ownerCapabilityForIntent(intent: string): OwnerCapability | null {
  if (intent === "operational_query") return "owner_operational_query";
  if (intent === "candidate_relay") return "owner_candidate_relay";
  if (intent === "rollback_last_knowledge") return "owner_knowledge_rollback";
  if (["knowledge_addition", "confirm_pending_knowledge", "reject_pending_knowledge", "zip_review_selection"].includes(intent)) {
    return "owner_knowledge_publish";
  }
  return null;
}
