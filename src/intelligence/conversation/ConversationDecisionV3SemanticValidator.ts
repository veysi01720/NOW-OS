import {
  detectAgeGenderDailyHours,
  detectApprovedApp,
  detectModelAcceptance,
  detectPhoneType,
} from "../../bridge/candidateIntakeStateMachine.js";
import { checkApprovedAppVocabulary } from "../../bridge/approvedAppGuard.js";
import type { ModelAdapterInput } from "../../modelAdapter/types.js";
import type { UserState } from "../../storage/types.js";
import {
  validateConversationDecisionV3Shape,
  type ConversationDecisionV3,
  type ConversationDecisionV3Action,
  type ConversationDecisionV3StatePatchField,
} from "./ConversationDecisionV3Schema.js";

export interface ConversationDecisionV3SemanticContext {
  role: ConversationDecisionV3["role"];
  channel_type: ModelAdapterInput["channelType"];
  latest_message: string;
  candidate_state: UserState;
  allowed_apps: string[];
  allowed_actions: ConversationDecisionV3Action[];
  canonical_policy_fact_ids: string[];
}

export interface ConversationDecisionV3SemanticValidationResult {
  ok: boolean;
  shape_valid: boolean;
  reason_codes: string[];
}

const CANDIDATE_STATE_ACTIONS = new Set<ConversationDecisionV3Action>([
  "ask_missing_age",
  "ask_missing_gender",
  "ask_missing_daily_hours",
  "record_work_model_acceptance",
  "record_work_preference",
  "ask_selected_app",
  "ask_phone_type",
  "begin_setup",
  "provide_installation_instruction",
]);

const MISSING_INFO_ACTIONS = new Set<ConversationDecisionV3Action>([
  "ask_missing_age",
  "ask_missing_gender",
  "ask_missing_daily_hours",
  "ask_selected_app",
  "ask_phone_type",
  "clarify_ambiguous_input",
]);

const DIRECT_ANSWER_ACTIONS = new Set<ConversationDecisionV3Action>([
  "answer_user_question",
  "clarify_previous_explanation",
]);

const STATE_UPDATE_ACTIONS = new Set<ConversationDecisionV3Action>([
  "acknowledge_information",
  "record_work_model_acceptance",
  "record_work_preference",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("tr-TR").normalize("NFKD").replace(/\p{M}/gu, "");
}

function readDecisionContext(input: ModelAdapterInput): Record<string, unknown> {
  return isRecord(input.contextPayload.conversation_decision_v2)
    ? input.contextPayload.conversation_decision_v2
    : {};
}

function mapRole(role: ModelAdapterInput["senderRole"]): ConversationDecisionV3["role"] {
  if (role === "owner" || role === "manager" || role === "candidate" || role === "unknown") return role;
  return "unknown";
}

export function buildConversationDecisionV3SemanticContext(
  input: ModelAdapterInput,
): ConversationDecisionV3SemanticContext {
  const decisionContext = readDecisionContext(input);
  const actions = Array.isArray(decisionContext.allowed_actions)
    ? decisionContext.allowed_actions.filter((value): value is ConversationDecisionV3Action => typeof value === "string")
    : [];
  const facts = Array.isArray(decisionContext.canonical_policy_facts)
    ? decisionContext.canonical_policy_facts
      .filter(isRecord)
      .map((fact) => fact.id)
      .filter((value): value is string => typeof value === "string")
    : [];

  return {
    role: mapRole(input.senderRole),
    channel_type: input.channelType,
    latest_message: input.contextPayload.user_message?.text?.trim() || input.normalizedUserMessage,
    candidate_state: input.contextPayload.state,
    allowed_apps: [...input.contextPayload.allowed_apps],
    allowed_actions: [...new Set(actions)],
    canonical_policy_fact_ids: [...new Set(facts)],
  };
}

function nonNullPatchFields(decision: ConversationDecisionV3): ConversationDecisionV3StatePatchField[] {
  return (Object.entries(decision.state_patch) as Array<[
    ConversationDecisionV3StatePatchField,
    ConversationDecisionV3["state_patch"][ConversationDecisionV3StatePatchField],
  ]>)
    .filter(([, value]) => value !== null)
    .map(([field]) => field);
}

function currentStateValue(
  field: ConversationDecisionV3StatePatchField,
  state: UserState,
): unknown {
  if (field === "work_model_acceptance") return state.model_acceptance ?? null;
  if (field === "work_model_disclosed") return state.work_model_disclosed ?? false;
  if (field === "preferred_work_mode") {
    return state.behavior_conversation_state?.preferredWorkMode
      ?? (state.behavior_conversation_state?.textOnlyPreference ? "text_only" : null);
  }
  if (field === "video_allowed") {
    return state.behavior_conversation_state?.videoAllowed
      ?? (state.behavior_conversation_state?.textOnlyPreference === true ? false : null);
  }
  return state[field as keyof UserState] ?? null;
}

function currentMessageSupports(
  field: ConversationDecisionV3StatePatchField,
  value: unknown,
  context: ConversationDecisionV3SemanticContext,
): boolean {
  const intake = detectAgeGenderDailyHours(context.latest_message);
  if (field === "age") return intake.age === value;
  if (field === "gender") return normalize(intake.gender ?? "") === normalize(String(value));
  if (field === "daily_hours") return intake.daily_hours === value;
  if (field === "selected_app") {
    const detected = detectApprovedApp(context.latest_message, context.allowed_apps);
    return detected !== null && normalize(detected) === normalize(String(value));
  }
  if (field === "phone_type") return detectPhoneType(context.latest_message).phone_type === value;
  if (field === "work_model_acceptance") return detectModelAcceptance(context.latest_message) === value;

  const latest = normalize(context.latest_message);
  const textOnly = /\b(sadece\s+(mesaj|mesajlas|yazis)|goruntulu\s+(istem|olmasin)|kamerasiz)\w*/u.test(latest);
  const videoAllowed = /\b(goruntulu|kamera|video)\b.*\b(olur|uygun|kabul|isterim)\b/u.test(latest);
  if (field === "preferred_work_mode") {
    return value === "text_only" ? textOnly : value === "video_or_voice_allowed" && videoAllowed;
  }
  if (field === "video_allowed") return value === false ? textOnly : value === true && videoAllowed;
  return false;
}

function validateActionCompatibility(
  decision: ConversationDecisionV3,
  patchFields: ConversationDecisionV3StatePatchField[],
  reasons: string[],
): void {
  const actions = new Set(decision.chosen_actions);
  const hasAny = (catalog: Set<ConversationDecisionV3Action>): boolean => [...catalog].some((item) => actions.has(item));

  if (decision.next_action === "ask_missing_info" && !hasAny(MISSING_INFO_ACTIONS)) {
    reasons.push("NEXT_ACTION_MISSING_INFO_INCOMPATIBLE");
  }
  if (decision.next_action === "answer_direct_question" && !hasAny(DIRECT_ANSWER_ACTIONS)) {
    reasons.push("NEXT_ACTION_DIRECT_ANSWER_INCOMPATIBLE");
  }
  if (decision.next_action === "update_candidate_state") {
    if (patchFields.length === 0) reasons.push("NEXT_ACTION_STATE_UPDATE_WITHOUT_PATCH");
    if (!hasAny(STATE_UPDATE_ACTIONS)) reasons.push("NEXT_ACTION_STATE_UPDATE_INCOMPATIBLE");
  } else if (patchFields.length > 0) {
    reasons.push("STATE_PATCH_WITHOUT_UPDATE_NEXT_ACTION");
  }
  if (["request_human_handoff", "escalate", "enqueue_followup"].includes(decision.next_action)) {
    if (!decision.requires_escalation || !actions.has("escalate_policy_missing")) {
      reasons.push("NEXT_ACTION_ESCALATION_INCOMPATIBLE");
    }
  }
  if (decision.next_action === "no_reply" && (actions.size > 0 || patchFields.length > 0)) {
    reasons.push("NEXT_ACTION_NO_REPLY_INCOMPATIBLE");
  }
}

function validatePatchValues(
  decision: ConversationDecisionV3,
  context: ConversationDecisionV3SemanticContext,
  reasons: string[],
): void {
  const patch = decision.state_patch;
  if (patch.age !== null && (!Number.isInteger(patch.age) || patch.age < 18 || patch.age > 65)) {
    reasons.push("STATE_PATCH_AGE_INVALID");
  }
  if (patch.daily_hours !== null && (!Number.isInteger(patch.daily_hours) || patch.daily_hours < 1 || patch.daily_hours > 16)) {
    reasons.push("STATE_PATCH_DAILY_HOURS_INVALID");
  }
  if (patch.gender !== null && !["erkek", "kadin", "kadın"].includes(normalize(patch.gender))) {
    reasons.push("STATE_PATCH_GENDER_INVALID");
  }
  if (patch.phone_type !== null && !["android", "ios"].includes(normalize(patch.phone_type))) {
    reasons.push("STATE_PATCH_PHONE_TYPE_INVALID");
  }
  if (patch.selected_app !== null && !context.allowed_apps.some((app) => normalize(app) === normalize(patch.selected_app ?? ""))) {
    reasons.push("STATE_PATCH_APP_NOT_APPROVED");
  }
  const preferenceTouched = patch.preferred_work_mode !== null || patch.video_allowed !== null;
  if (preferenceTouched && !(patch.preferred_work_mode === "text_only" && patch.video_allowed === false)) {
    reasons.push("STATE_PATCH_TEXT_ONLY_PAIR_INCONSISTENT");
  }
}

function validatePatchEvidence(
  decision: ConversationDecisionV3,
  context: ConversationDecisionV3SemanticContext,
  patchFields: ConversationDecisionV3StatePatchField[],
  reasons: string[],
): void {
  const patchFieldSet = new Set(patchFields);
  const evidenceCounts = new Map<ConversationDecisionV3StatePatchField, number>();
  const factIds = new Set(context.canonical_policy_fact_ids);
  const usedFacts = new Set(decision.policy_facts_used);

  for (const evidence of decision.state_patch_evidence) {
    evidenceCounts.set(evidence.field, (evidenceCounts.get(evidence.field) ?? 0) + 1);
    if (!patchFieldSet.has(evidence.field)) reasons.push("STATE_PATCH_EVIDENCE_ORPHAN");
    if (evidence.source !== "canonical_policy_fact" && evidence.evidence_ref !== null) {
      reasons.push("STATE_PATCH_EVIDENCE_REF_NOT_NULL");
    }
    if (evidence.source === "canonical_policy_fact") {
      const validRef = evidence.evidence_ref !== null
        && /^[A-Za-z0-9._:-]{1,128}$/.test(evidence.evidence_ref)
        && factIds.has(evidence.evidence_ref)
        && usedFacts.has(evidence.evidence_ref);
      if (!validRef) reasons.push("STATE_PATCH_POLICY_EVIDENCE_INVALID");
    }

    const value = decision.state_patch[evidence.field];
    if (value === null) continue;
    if (evidence.source === "current_message" && !currentMessageSupports(evidence.field, value, context)) {
      reasons.push("STATE_PATCH_CURRENT_MESSAGE_EVIDENCE_MISMATCH");
    }
    if (evidence.source === "existing_state" && currentStateValue(evidence.field, context.candidate_state) !== value) {
      reasons.push("STATE_PATCH_EXISTING_STATE_EVIDENCE_MISMATCH");
    }
    if (evidence.source === "reply_content") {
      if (evidence.field !== "work_model_disclosed" || value !== true || decision.policy_facts_used.length === 0) {
        reasons.push("STATE_PATCH_REPLY_EVIDENCE_INCOMPATIBLE");
      }
    }
    if (evidence.source === "canonical_policy_fact" && evidence.field !== "work_model_disclosed") {
      reasons.push("STATE_PATCH_POLICY_EVIDENCE_INCOMPATIBLE");
    }
  }

  for (const field of patchFields) {
    const count = evidenceCounts.get(field) ?? 0;
    if (count === 0) reasons.push("STATE_PATCH_EVIDENCE_MISSING");
    if (count > 1) reasons.push("STATE_PATCH_EVIDENCE_DUPLICATE");
  }
}

export function validateConversationDecisionV3Semantics(
  value: unknown,
  context: ConversationDecisionV3SemanticContext,
): ConversationDecisionV3SemanticValidationResult {
  const shape = validateConversationDecisionV3Shape(value);
  if (!shape.ok) return { ok: false, shape_valid: false, reason_codes: shape.reason_codes };

  const decision = value as ConversationDecisionV3;
  const reasons: string[] = [];
  const allowedActions = new Set(context.allowed_actions);
  const factIds = new Set(context.canonical_policy_fact_ids);
  const patchFields = nonNullPatchFields(decision);

  if (decision.role !== context.role) reasons.push("ROLE_MISMATCH");
  if (context.channel_type === "group" && (decision.next_action !== "no_reply" || decision.chosen_actions.length > 0)) {
    reasons.push("GROUP_DECISION_NOT_SAFE_IGNORED");
  }
  if (["owner", "manager", "group"].includes(context.role)) {
    if (decision.chosen_actions.some((action) => CANDIDATE_STATE_ACTIONS.has(action)) || patchFields.length > 0) {
      reasons.push("ROLE_CANDIDATE_STATE_ACTION_DENIED");
    }
  }
  if (context.role === "candidate" && ["owner_report", "manager_summary"].includes(decision.next_action)) {
    reasons.push("ROLE_PRIVILEGED_NEXT_ACTION_DENIED");
  }
  if (decision.next_action === "owner_report" && context.role !== "owner") reasons.push("OWNER_REPORT_ROLE_DENIED");
  if (decision.next_action === "manager_summary" && !["owner", "manager"].includes(context.role)) {
    reasons.push("MANAGER_SUMMARY_ROLE_DENIED");
  }

  if (decision.chosen_actions.some((action) => !allowedActions.has(action))) {
    reasons.push("CHOSEN_ACTION_NOT_ALLOWED");
  }
  if (decision.policy_facts_used.some((factId) => !factIds.has(factId))) {
    reasons.push("POLICY_FACT_NOT_GROUNDED");
  }

  validateActionCompatibility(decision, patchFields, reasons);
  validatePatchValues(decision, context, reasons);
  validatePatchEvidence(decision, context, patchFields, reasons);

  const appGate = checkApprovedAppVocabulary(decision.reply.text, {
    allowed_apps: context.allowed_apps,
    selected_app: context.candidate_state.selected_app,
  });
  if (!appGate.ok) reasons.push("UNAPPROVED_APP_IN_REPLY");

  return {
    ok: reasons.length === 0,
    shape_valid: true,
    reason_codes: [...new Set(reasons)],
  };
}
