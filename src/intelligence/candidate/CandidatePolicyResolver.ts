import type { UserState } from "../../storage/types.js";
import type { ConversationPolicyFact } from "../conversation/ConversationDecisionSchema.js";

export interface CandidatePolicyResolution {
  facts: ConversationPolicyFact[];
  policyMissing: boolean;
}

export function resolveCandidatePolicy(state: UserState, allowedApps: string[]): CandidatePolicyResolution {
  const facts: ConversationPolicyFact[] = [];
  const app = allowedApps.find((item) => item.toLocaleLowerCase("tr-TR") === "layla") ?? allowedApps[0] ?? null;

  if (state.gender === "erkek" || state.gender === "male") {
    if (!app) {
      return { facts, policyMissing: true };
    }
    facts.push({
      id: "male_candidate_work_model",
      topic: "male_candidate_work_model",
      fact:
        `${app} is the approved app to mention for a male candidate when the candidate wants text/chat-oriented work; do not present camera/video as required.`,
      content:
        `${app} is the approved app to mention for a male candidate when the candidate wants text/chat-oriented work; do not present camera/video as required.`,
      source: "canonical_policy",
      version: "conversation_v2"
    });
    facts.push({
      id: "work_model_acceptance_required",
      topic: "work_model_acceptance",
      fact:
        "After age, gender, and daily availability are captured, explain the work model clearly and ask for explicit acceptance before any setup, link, invite code, phone setup, or profile setup.",
      content:
        "After age, gender, and daily availability are captured, explain the work model clearly and ask for explicit acceptance before any setup, link, invite code, phone setup, or profile setup.",
      source: "canonical_policy",
      version: "conversation_v2"
    });
    facts.push({
      id: "candidate_work_steps_chat_based",
      topic: "candidate_work_steps",
      fact:
        "The safe high-level explanation is: the candidate proceeds in the approved app, follows team guidance, and communicates through chats/messages; avoid unsupported claims about earnings, identity, account ownership, or hidden platform behavior.",
      content:
        "The safe high-level explanation is: the candidate proceeds in the approved app, follows team guidance, and communicates through chats/messages; avoid unsupported claims about earnings, identity, account ownership, or hidden platform behavior.",
      source: "canonical_policy",
      version: "conversation_v2"
    });
    facts.push({
      id: "male_account_policy_boundary",
      topic: "account_profile_boundary",
      fact:
        "There is no approved canonical rule saying the candidate must open or use a male account/profile; answer account/profile questions directly by saying this is not confirmed and the team will not invent that detail.",
      content:
        "There is no approved canonical rule saying the candidate must open or use a male account/profile; answer account/profile questions directly by saying this is not confirmed and the team will not invent that detail.",
      source: "canonical_policy",
      version: "conversation_v2"
    });
  }

  if (facts.length === 0 && app) {
    facts.push({
      id: "candidate_default_work_model",
      topic: "candidate_work_model",
      fact:
        `${app} may be mentioned as the approved app; explain only verified high-level work steps and do not move to setup before missing fields and explicit acceptance are complete.`,
      content:
        `${app} may be mentioned as the approved app; explain only verified high-level work steps and do not move to setup before missing fields and explicit acceptance are complete.`,
      source: "canonical_policy",
      version: "conversation_v2"
    });
  }

  return { facts, policyMissing: facts.length === 0 };
}
