import { createHash } from "node:crypto";
import { DEFAULT_UNAPPROVED_APP_TERMS } from "../../bridge/approvedAppGuard.js";
import type { ModelAdapterInput } from "../../modelAdapter/types.js";
import type {
  ConversationDecisionV3,
  ConversationDecisionV3Action,
  ConversationDecisionV3NextAction,
} from "./ConversationDecisionV3Schema.js";

export const MISSING_POLICY_NORMALIZATION_ID = "missing_policy_action_tuple_v1";

export interface ConversationDecisionV3PolicyNormalizationResult {
  decision: ConversationDecisionV3;
  applied: boolean;
  normalization_id: string | null;
  reason_codes: string[];
  original_control_tuple_hash: string;
  normalized_control_tuple_hash: string;
}

interface ControlTuple {
  chosen_actions: ConversationDecisionV3Action[];
  next_action: ConversationDecisionV3NextAction;
  requires_escalation: boolean;
  escalation_reason: string | null;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("tr-TR").normalize("NFKD").replace(/\p{M}/gu, "");
}

function containsTerm(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, "iu").test(text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inferredIntent(input: ModelAdapterInput): string | null {
  if (typeof input.metadata.inferredIntent === "string") return input.metadata.inferredIntent;
  const rawContext = input.contextPayload.conversation_decision_v2;
  if (!isRecord(rawContext) || !isRecord(rawContext.latest_message)) return null;
  return typeof rawContext.latest_message.inferred_intent === "string"
    ? rawContext.latest_message.inferred_intent
    : null;
}

function allowedActions(input: ModelAdapterInput): Set<ConversationDecisionV3Action> {
  const rawContext = input.contextPayload.conversation_decision_v2;
  if (!isRecord(rawContext) || !Array.isArray(rawContext.allowed_actions)) return new Set();
  return new Set(rawContext.allowed_actions.filter(
    (value): value is ConversationDecisionV3Action => typeof value === "string",
  ));
}

function controlTuple(decision: ConversationDecisionV3): ControlTuple {
  return {
    chosen_actions: [...decision.chosen_actions],
    next_action: decision.next_action,
    requires_escalation: decision.requires_escalation,
    escalation_reason: decision.escalation_reason,
  };
}

function tupleHash(tuple: ControlTuple): string {
  return createHash("sha256").update(JSON.stringify(tuple)).digest("hex");
}

function tuplesEqual(left: ControlTuple, right: ControlTuple): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function unchanged(
  decision: ConversationDecisionV3,
  reason: string,
): ConversationDecisionV3PolicyNormalizationResult {
  const hash = tupleHash(controlTuple(decision));
  return {
    decision,
    applied: false,
    normalization_id: null,
    reason_codes: [reason],
    original_control_tuple_hash: hash,
    normalized_control_tuple_hash: hash,
  };
}

function matchingUnapprovedTerm(input: ModelAdapterInput): string | null {
  const latestMessage = input.contextPayload.user_message?.text?.trim() || input.normalizedUserMessage;
  const approved = new Set(input.contextPayload.allowed_apps.map(normalize));
  return DEFAULT_UNAPPROVED_APP_TERMS.find((term) =>
    !approved.has(normalize(term)) && containsTerm(latestMessage, term),
  ) ?? null;
}

function hasApprovedStructuredResolution(input: ModelAdapterInput, term: string): boolean {
  const normalizedTerm = normalize(term);
  const approved = new Set(input.contextPayload.allowed_apps.map(normalize));
  return input.contextPayload.structured_facts?.app_facts.some((fact) =>
    approved.has(normalize(fact.app))
    && [fact.app, ...fact.aliases].some((name) => normalize(name) === normalizedTerm),
  ) === true;
}

function isPaymentTrustIntent(intent: string | null): boolean {
  return ["payment_question", "payment_and_trust_objection", "handle_trust_objection"].includes(intent ?? "");
}

function hasVerifiedPolicyFacts(input: ModelAdapterInput): boolean {
  const rawContext = input.contextPayload.conversation_decision_v2;
  return isRecord(rawContext)
    && Array.isArray(rawContext.canonical_policy_facts)
    && rawContext.canonical_policy_facts.length > 0;
}

function hasUnsafePaymentTrustWording(reply: string): boolean {
  const normalized = normalize(reply);
  return [
    "kesin kazan",
    "sorun yasamaz",
    "hic risk yok",
    "kesin guvenli",
    "garanti kazanc",
  ].some((term) => normalized.includes(term));
}

function safePaymentTrustReply(decision: ConversationDecisionV3): ConversationDecisionV3 {
  return {
    ...decision,
    reply: {
      ...decision.reply,
      text: "Bu konuda kesin bir guvence veremem; dogrulanmis odeme bilgisi yoksa ekip kontrol etsin.",
      contains_question: false,
    },
  };
}

function canonicalTuple(actions: Set<ConversationDecisionV3Action>): ControlTuple | null {
  if (actions.has("ask_selected_app")) {
    return {
      chosen_actions: ["ask_selected_app"],
      next_action: "ask_missing_info",
      requires_escalation: false,
      escalation_reason: null,
    };
  }
  if (actions.has("escalate_policy_missing")) {
    return {
      chosen_actions: ["escalate_policy_missing"],
      next_action: "escalate_missing_info",
      requires_escalation: true,
      escalation_reason: "missing_verified_app_policy_fact",
    };
  }
  if (actions.has("clarify_ambiguous_input")) {
    return {
      chosen_actions: ["clarify_ambiguous_input"],
      next_action: "reply_only",
      requires_escalation: false,
      escalation_reason: null,
    };
  }
  return null;
}

export function normalizeConversationDecisionV3MissingPolicy(
  decision: ConversationDecisionV3,
  input: ModelAdapterInput,
): ConversationDecisionV3PolicyNormalizationResult {
  if (input.metadata.featureFlags.responses_missing_policy_normalization_enabled !== true) {
    return unchanged(decision, "NORMALIZATION_DISABLED");
  }
  if (input.senderRole !== "candidate") return unchanged(decision, "ROLE_NOT_CANDIDATE");
  if (input.channelType !== "private") return unchanged(decision, "CHANNEL_NOT_PRIVATE");
  const intent = inferredIntent(input);
  const appIntent = ["app_fact_question", "app_selection_question", "unknown_app_policy_missing"].includes(intent ?? "");
  const paymentTrustIntent = isPaymentTrustIntent(intent) && !hasVerifiedPolicyFacts(input);
  if (!appIntent && !paymentTrustIntent) {
    return unchanged(decision, "INTENT_NOT_MISSING_POLICY_APP");
  }
  if (appIntent) {
    const term = matchingUnapprovedTerm(input);
    if (term === null) return unchanged(decision, "UNAPPROVED_APP_TERM_NOT_FOUND");
    if (hasApprovedStructuredResolution(input, term)) {
      return unchanged(decision, "APP_FACT_ALREADY_RESOLVED");
    }
  }
  const canonical = canonicalTuple(allowedActions(input));
  const unsafeReply = paymentTrustIntent && hasUnsafePaymentTrustWording(decision.reply.text);
  if (canonical === null && !unsafeReply) return unchanged(decision, "NO_SAFE_ALLOWED_ACTION");

  const original = controlTuple(decision);
  const normalizedControl = canonical !== null && !tuplesEqual(original, canonical);
  const normalizedDecision = normalizedControl
    ? {
      ...decision,
      chosen_actions: [...canonical.chosen_actions],
      next_action: canonical.next_action,
      requires_escalation: canonical.requires_escalation,
      escalation_reason: canonical.escalation_reason,
    }
    : decision;
  const finalDecision = unsafeReply ? safePaymentTrustReply(normalizedDecision) : normalizedDecision;
  const normalizedReply = finalDecision.reply.text !== decision.reply.text;
  if (!normalizedControl && !normalizedReply) {
    return {
      ...unchanged(finalDecision, "ALREADY_CANONICAL"),
      normalization_id: MISSING_POLICY_NORMALIZATION_ID,
    };
  }
  return {
    decision: finalDecision,
    applied: true,
    normalization_id: MISSING_POLICY_NORMALIZATION_ID,
    reason_codes: [
      ...(normalizedControl ? ["MISSING_POLICY_CONTROL_TUPLE_NORMALIZED"] : []),
      ...(normalizedReply ? ["UNSAFE_PAYMENT_TRUST_REPLY_REPLACED"] : []),
    ],
    original_control_tuple_hash: tupleHash(original),
    normalized_control_tuple_hash: tupleHash(controlTuple(finalDecision)),
  };
}
