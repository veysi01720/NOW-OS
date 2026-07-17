import type { UserState } from "../../storage/types.js";
import { deriveCandidateState, detectApprovedApp, detectModelAcceptance, detectPhoneType } from "../../bridge/candidateIntakeStateMachine.js";
import type { ConversationDecision, ConversationDecisionContext } from "../conversation/ConversationDecisionSchema.js";

export interface StatePatchResult {
  ok: boolean;
  state: UserState;
  reason_codes: string[];
}

export function validateAndApplyStatePatch(
  current: UserState,
  decision: ConversationDecision,
  context: ConversationDecisionContext,
  allowedApps: string[]
): StatePatchResult {
  const next: UserState = { ...current, missing_fields: [...current.missing_fields] };
  const reasons: string[] = [];
  const patch = decision.state_patch ?? {};

  if (patch.work_model_disclosed === true) {
    next.work_model_disclosed = true;
  }

  if (patch.work_model_acceptance === "pending" && patch.work_model_disclosed === true) {
    next.model_acceptance = "pending";
  } else if (patch.work_model_acceptance !== undefined && patch.work_model_acceptance !== null) {
    const detected = detectModelAcceptance(context.latest_message.text);
    if (detected === patch.work_model_acceptance && current.work_model_disclosed === true) {
      next.model_acceptance = patch.work_model_acceptance;
    } else {
      reasons.push("STATE_PATCH_ACCEPTANCE_WITHOUT_EVIDENCE");
    }
  }

  if (patch.selected_app !== undefined && patch.selected_app !== null) {
    const detectedApp = detectApprovedApp(context.latest_message.text, allowedApps);
    if (detectedApp === patch.selected_app) {
      next.selected_app = patch.selected_app;
    } else {
      reasons.push("STATE_PATCH_SELECTED_APP_WITHOUT_EVIDENCE");
    }
  }

  if (patch.phone_type !== undefined && patch.phone_type !== null) {
    const detectedPhone = detectPhoneType(context.latest_message.text);
    if (detectedPhone.phone_type === patch.phone_type) {
      next.phone_type = patch.phone_type;
    } else {
      reasons.push("STATE_PATCH_PHONE_TYPE_WITHOUT_EVIDENCE");
    }
  }

  if (patch.age !== undefined || patch.gender !== undefined || patch.daily_hours !== undefined) {
    reasons.push("AUTHORITATIVE_INTAKE_PATCH_NOT_ALLOWED_FROM_DECISION");
  }

  return {
    ok: reasons.length === 0,
    state: deriveCandidateState(next),
    reason_codes: [...new Set(reasons)]
  };
}
