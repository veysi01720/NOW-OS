import type { UserState } from "../../storage/types.js";
import type { StructuredAppFact } from "../../bridge/structuredAppFacts.js";
import type { ConversationPolicyFact } from "../conversation/ConversationDecisionSchema.js";

export interface CandidatePolicyResolution {
  facts: ConversationPolicyFact[];
  policyMissing: boolean;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("tr-TR").normalize("NFKD").replace(/\p{M}/gu, "").replace(/ı/gu, "i");
}

function appMatches(value: string | null | undefined, fact: StructuredAppFact): boolean {
  if (!value) return false;
  const target = normalize(value);
  return [
    fact.app,
    fact.android_name,
    fact.ios_name,
    ...fact.aliases,
  ].some((candidate) => normalize(candidate) === target);
}

function selectStructuredFact(
  state: UserState,
  allowedApps: string[],
  structuredFacts: StructuredAppFact[],
): StructuredAppFact | null {
  const ownerApproved = structuredFacts.filter((fact) => normalize(fact.status).includes("owner_approved"));
  if (ownerApproved.length === 0) return null;

  const selected = ownerApproved.find((fact) => appMatches(state.selected_app, fact));
  if (selected) return selected;

  const textOnly = ownerApproved.find((fact) => fact.capabilities.text_only);
  if (textOnly) return textOnly;

  const allowed = ownerApproved.find((fact) => allowedApps.some((app) => appMatches(app, fact)));
  return allowed ?? ownerApproved[0] ?? null;
}

function structuredJobDefinitionFact(fact: StructuredAppFact): ConversationPolicyFact {
  const display = fact.app === fact.ios_name ? fact.app : `${fact.app} (iPhone: ${fact.ios_name})`;
  const textOnlyBoundary = fact.capabilities.text_only
    ? "Text/chat-oriented work is supported; do not present camera or video as required."
    : "No text-only guarantee is encoded for this app; do not invent camera, account, or profile requirements.";
  const invitePart = fact.invite_code ? ` Approved invite code: ${fact.invite_code}.` : "";
  const content =
    `Approved app: ${display}. Job definition: the candidate answers incoming chats/messages in writing inside the approved app. ` +
    `${textOnlyBoundary}${invitePart} Do not invent earnings, setup links, account ownership, or hidden platform behavior.`;
  return {
    id: `structured_app_job_definition_${normalize(fact.app).replace(/[^a-z0-9]+/gu, "_")}`,
    topic: "candidate_work_model",
    fact: content,
    content,
    source: "knowledge_bank",
    version: "app_facts_structured.json",
  };
}

export function resolveCandidatePolicy(
  state: UserState,
  allowedApps: string[],
  structuredFacts: StructuredAppFact[] = [],
): CandidatePolicyResolution {
  const facts: ConversationPolicyFact[] = [];
  const structuredFact = selectStructuredFact(state, allowedApps, structuredFacts);
  if (structuredFact) facts.push(structuredJobDefinitionFact(structuredFact));
  const app = structuredFact?.app ?? allowedApps.find((item) => item.toLocaleLowerCase("tr-TR") === "layla") ?? allowedApps[0] ?? null;

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

  if (!facts.some((fact) => fact.id === "candidate_default_work_model") && app) {
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
