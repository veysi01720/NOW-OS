import type { ConversationDecision, ConversationDecisionContext, DecisionValidationResult } from "./ConversationDecisionSchema.js";

const GENERIC_CLOSINGS = [
  "başka merak ettiğin bir şey var mı",
  "baska merak ettigin bir sey var mi",
  "başka sormak istediğin var mı",
  "baska sormak istedigin var mi",
  "başka sorun var mı",
  "baska sorun var mi",
  "başka bir şey sormak ister misin",
  "baska bir sey sormak ister misin",
  "başka bir konuda yardımcı olayım mı",
  "baska bir konuda yardimci olayim mi",
  "yardımcı olabileceğim başka bir konu var mı",
  "yardimci olabilecegim baska bir konu var mi",
  "detay ister misin",
  "başka ne öğrenmek istersin",
  "baska ne ogrenmek istersin"
];

function normalize(value: string): string {
  return value.toLocaleLowerCase("tr-TR").normalize("NFKD").replace(/\p{M}/gu, "").replace(/ı/gu, "i");
}

function isFirstContactIntent(intent: string | null | undefined): boolean {
  return intent === "greeting_or_first_contact" || intent === "candidate_first_contact";
}

function isJobDefinitionIntent(intent: string | null | undefined): boolean {
  return intent === "ask_job_definition";
}

export function parseConversationDecision(rawText: string): ConversationDecision | null {
  const trimmed = rawText.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(trimmed) as ConversationDecision;
    if (parsed?.decision_version !== "2.0") return null;
    if (typeof parsed.reply?.text !== "string") return null;
    if (!Array.isArray(parsed.chosen_actions)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function validateConversationDecision(
  decision: ConversationDecision,
  context: ConversationDecisionContext
): DecisionValidationResult {
  const reasons: string[] = [];
  const reply = normalize(decision.reply.text);
  const latest = normalize(context.latest_message.text);
  const actionSet = new Set(context.allowed_actions);

  for (const action of decision.chosen_actions) {
    if (!actionSet.has(action)) reasons.push(`FORBIDDEN_ACTION_${action}`);
  }

  if (decision.self_check.used_generic_closing || GENERIC_CLOSINGS.some((closing) => reply.includes(normalize(closing)))) {
    reasons.push("GENERIC_CONVERSATION_CLOSER");
  }
  if (context.latest_message.inferred_intent === "clarify_previous_explanation") {
    if (decision.intent.primary !== "clarify_previous_explanation") {
      reasons.push("CLARIFICATION_INTENT_NOT_RECOGNIZED");
    }
    if (!decision.direct_question.answered_in_reply || !decision.self_check.answered_latest_message) {
      reasons.push("CLARIFICATION_NOT_ANSWERED");
    }
  }

  if (
    context.derived_state.intake_complete &&
    context.candidate_state.work_model_acceptance !== "accepted" &&
    !isFirstContactIntent(context.latest_message.inferred_intent) &&
    !isFirstContactIntent(decision.intent.primary)
  ) {
    const directQuestionAnswered =
      decision.chosen_actions.includes("answer_user_question") &&
      (decision.direct_question.answered_in_reply || decision.self_check.answered_latest_message);
    if (reply.includes("kurulum icin hazirsin") || reply.includes("kuruluma hazirsin") || decision.chosen_actions.includes("begin_setup")) {
      reasons.push("INSTALLATION_OFFERED_TOO_EARLY");
    }
    if (
      !directQuestionAnswered &&
      !decision.chosen_actions.includes("explain_work_model") &&
      !decision.chosen_actions.includes("request_work_model_acceptance")
    ) {
      reasons.push("WORK_MODEL_NOT_DISCLOSED");
    }
  }

  if (latest.includes("nasil") || latest.includes("nasıl") || latest.includes("hesabi") || latest.includes("hesabı") || latest.includes("anlamadim")) {
    if (!decision.direct_question.answered_in_reply || !decision.self_check.answered_latest_message) {
      reasons.push("QUESTION_NOT_FULLY_ANSWERED");
    }
  }
  if (isJobDefinitionIntent(context.latest_message.inferred_intent)) {
    if (!isJobDefinitionIntent(decision.intent.primary)) {
      reasons.push("JOB_DEFINITION_INTENT_NOT_RECOGNIZED");
    }
    if (!decision.direct_question.answered_in_reply || !decision.self_check.answered_latest_message) {
      reasons.push("QUESTION_NOT_FULLY_ANSWERED");
    }
  }

  if (decision.self_check.asked_known_information_again) reasons.push("KNOWN_INFORMATION_REASKED");
  if (decision.self_check.invented_policy) reasons.push("UNSUPPORTED_POLICY_FACT");
  if (decision.self_check.offered_setup_too_early) reasons.push("INSTALLATION_OFFERED_TOO_EARLY");

  const usedFacts = new Set(decision.policy_facts_used);
  for (const factId of usedFacts) {
    if (!context.canonical_policy_facts.some((fact) => fact.id === factId)) {
      reasons.push("UNSUPPORTED_POLICY_FACT");
    }
  }

  if (decision.reply.text.length > context.runtime_constraints.max_reply_length) {
    reasons.push("REPLY_TOO_LONG");
  }

  return { ok: reasons.length === 0, reason_codes: [...new Set(reasons)] };
}

export { GENERIC_CLOSINGS };
