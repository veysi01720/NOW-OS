export type ValidatorLayer = "layer_1" | "layer_2";

// Keep this catalog explicit. A reason code's name must never determine its severity.
export const LAYER_1_REASON_CODES = new Set([
  "ROLE_MISMATCH",
  "GROUP_DECISION_NOT_SAFE_IGNORED",
  "ROLE_CANDIDATE_STATE_ACTION_DENIED",
  "ROLE_PRIVILEGED_NEXT_ACTION_DENIED",
  "OWNER_REPORT_ROLE_DENIED",
  "MANAGER_SUMMARY_ROLE_DENIED",
  "CHOSEN_ACTION_NOT_ALLOWED",
  "POLICY_FACT_NOT_GROUNDED",
  "NEXT_ACTION_STATE_UPDATE_WITHOUT_PATCH",
  "NEXT_ACTION_ESCALATION_INCOMPATIBLE",
  "NEXT_ACTION_MISSING_INFO_ESCALATION_INCOMPATIBLE",
  "NEXT_ACTION_NO_REPLY_INCOMPATIBLE",
  "STATE_PATCH_AGE_INVALID",
  "STATE_PATCH_DAILY_HOURS_INVALID",
  "STATE_PATCH_GENDER_INVALID",
  "STATE_PATCH_PHONE_TYPE_INVALID",
  "STATE_PATCH_APP_NOT_APPROVED",
  "STATE_PATCH_TEXT_ONLY_PAIR_INCONSISTENT",
  "STATE_PATCH_EVIDENCE_ORPHAN",
  "STATE_PATCH_EVIDENCE_REF_NOT_NULL",
  "STATE_PATCH_POLICY_EVIDENCE_INVALID",
  "STATE_PATCH_CURRENT_MESSAGE_EVIDENCE_MISMATCH",
  "STATE_PATCH_EXISTING_STATE_EVIDENCE_MISMATCH",
  "STATE_PATCH_REPLY_EVIDENCE_INCOMPATIBLE",
  "STATE_PATCH_POLICY_EVIDENCE_INCOMPATIBLE",
  "STATE_PATCH_EVIDENCE_MISSING",
  "STATE_PATCH_EVIDENCE_DUPLICATE",
  "STATE_PATCH_ACCEPTANCE_WITHOUT_EVIDENCE",
  "STATE_PATCH_SELECTED_APP_WITHOUT_EVIDENCE",
  "STATE_PATCH_PHONE_TYPE_WITHOUT_EVIDENCE",
  "UNAPPROVED_APP_IN_REPLY",
  "SENSITIVE_DATA_REQUEST",
  "UNSUPPORTED_POLICY_FACT",
  "GUARANTEE_OR_UNSUPPORTED_EARNINGS_CLAIM",
  "HUMAN_HANDOFF_REQUIRED_BUT_MISSING",
]);

export const LAYER_2_REASON_CODES = new Set([
  "NEXT_ACTION_MISSING_INFO_INCOMPATIBLE",
  "NEXT_ACTION_DIRECT_ANSWER_INCOMPATIBLE",
  "NEXT_ACTION_STATE_UPDATE_INCOMPATIBLE",
  "STATE_PATCH_WITHOUT_UPDATE_NEXT_ACTION",
  "ACTION_ORDER_VARIANCE",
  "PARTIAL_INTAKE_RESPONSE_VARIANCE",
  "WORK_MODEL_DISCLOSURE_ACTIONS_MISSING",
  "QUESTION_NOT_FULLY_ANSWERED",
  "GENERIC_CONVERSATION_CLOSER",
  "KNOWN_INFORMATION_REASKED",
]);

export function classifyValidatorReasonCode(code: string): ValidatorLayer {
  if (LAYER_1_REASON_CODES.has(code)) return "layer_1";
  if (LAYER_2_REASON_CODES.has(code)) return "layer_2";
  // Unknown validation failures remain fail-closed until explicitly classified.
  return "layer_1";
}

export function splitValidatorReasonCodes(reasonCodes: string[]): {
  layer_1_reason_codes: string[];
  layer_2_reason_codes: string[];
  unknown_reason_codes: string[];
} {
  return reasonCodes.reduce((result, code) => {
    if (!LAYER_1_REASON_CODES.has(code) && !LAYER_2_REASON_CODES.has(code)) {
      result.unknown_reason_codes.push(code);
      result.layer_1_reason_codes.push(code);
    } else if (classifyValidatorReasonCode(code) === "layer_1") {
      result.layer_1_reason_codes.push(code);
    } else {
      result.layer_2_reason_codes.push(code);
    }
    return result;
  }, {
    layer_1_reason_codes: [] as string[],
    layer_2_reason_codes: [] as string[],
    unknown_reason_codes: [] as string[],
  });
}
