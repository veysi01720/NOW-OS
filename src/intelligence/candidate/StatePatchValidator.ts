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
    const requestedPhone = detectPhoneType(String(patch.phone_type)).phone_type;
    if (detectedPhone.phone_type === requestedPhone && requestedPhone !== null) {
      next.phone_type = patch.phone_type;
    } else {
      reasons.push("STATE_PATCH_PHONE_TYPE_WITHOUT_EVIDENCE");
    }
  }

  const preferenceTouched =
    (patch.preferred_work_mode !== undefined && patch.preferred_work_mode !== null)
    || (patch.video_allowed !== undefined && patch.video_allowed !== null);
  if (preferenceTouched) {
    if (patch.preferred_work_mode !== "text_only" || patch.video_allowed !== false) {
      reasons.push("STATE_PATCH_TEXT_ONLY_PREFERENCE_INVALID");
    } else {
      next.behavior_conversation_state = {
        tenantId: current.behavior_conversation_state?.tenantId ?? "now_os",
        conversationId: current.behavior_conversation_state?.conversationId ?? "state_patch",
        channelType: current.behavior_conversation_state?.channelType ?? "private",
        currentMode: current.behavior_conversation_state?.currentMode ?? "candidate",
        userStage: current.behavior_conversation_state?.userStage ?? current.current_state,
        lastResolvedIntent: current.behavior_conversation_state?.lastResolvedIntent ?? null,
        unresolvedObjections: [...(current.behavior_conversation_state?.unresolvedObjections ?? [])],
        completedTopics: [...(current.behavior_conversation_state?.completedTopics ?? [])],
        pendingTopics: [...(current.behavior_conversation_state?.pendingTopics ?? current.missing_fields)],
        lastAssistantAction: current.behavior_conversation_state?.lastAssistantAction ?? "record_work_preference",
        lastUserSentiment: current.behavior_conversation_state?.lastUserSentiment ?? "neutral",
        escalationStatus: current.behavior_conversation_state?.escalationStatus ?? "none",
        summary: current.behavior_conversation_state?.summary ?? "",
        textOnlyPreference: true,
        preferredWorkMode: "text_only",
        videoAllowed: false,
        updatedAt: current.behavior_conversation_state?.updatedAt ?? "state_patch",
      };
    }
  }

  const intakePatch = {
    age: patch.age,
    gender: patch.gender,
    daily_hours: patch.daily_hours,
  };
  const intakeFields = Object.entries(intakePatch)
    .filter(([, value]) => value !== undefined && value !== null) as Array<
      ["age" | "gender" | "daily_hours", number | string]
    >;
  const authoritativeIntakeEcho = intakeFields.length > 0
    && intakeFields.every(([field, value]) =>
      context.facts_extracted_from_current_message.includes(field)
      && current[field] === value,
    );
  if (intakeFields.length > 0 && !authoritativeIntakeEcho) {
    reasons.push("AUTHORITATIVE_INTAKE_PATCH_NOT_ALLOWED_FROM_DECISION");
  }

  return {
    ok: reasons.length === 0,
    state: deriveCandidateState(next),
    reason_codes: [...new Set(reasons)]
  };
}
