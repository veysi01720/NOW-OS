import type { UserState } from "../../storage/types.js";
import type { ConversationDecisionAction } from "./ConversationDecisionSchema.js";

export interface AllowedActionSet {
  allowed: ConversationDecisionAction[];
  forbidden: string[];
}

export function resolveAllowedActions(state: UserState): AllowedActionSet {
  const allowed: ConversationDecisionAction[] = [
    "answer_user_question",
    "clarify_previous_explanation",
    "clarify_ambiguous_input",
    "handle_user_frustration",
    "explain_work_model"
  ];
  const forbidden = new Set<string>();

  const intakeMissing = {
    age: state.age === null,
    gender: state.gender === null,
    daily_hours: state.daily_hours === null
  };
  const intakeComplete = !intakeMissing.age && !intakeMissing.gender && !intakeMissing.daily_hours;

  if (!intakeComplete) {
    if (intakeMissing.age) allowed.push("ask_missing_age");
    if (intakeMissing.gender) allowed.push("ask_missing_gender");
    if (intakeMissing.daily_hours) allowed.push("ask_missing_daily_hours");
    forbidden.add("begin_setup");
    forbidden.add("provide_installation_instruction");
    forbidden.add("send_invite_code");
    return { allowed, forbidden: [...forbidden] };
  }

  allowed.push("acknowledge_information", "request_work_model_acceptance");

  if (state.model_acceptance !== "accepted") {
    forbidden.add("begin_setup");
    forbidden.add("provide_installation_instruction");
    forbidden.add("send_invite_code");
    forbidden.add("ask_selected_app");
    forbidden.add("ask_phone_type");
    return { allowed, forbidden: [...forbidden] };
  }

  allowed.push("record_work_model_acceptance");
  if (state.selected_app === null) allowed.push("ask_selected_app");
  if (state.phone_type === null) allowed.push("ask_phone_type");
  if (state.selected_app !== null && state.phone_type !== null) {
    allowed.push("begin_setup", "provide_installation_instruction");
  }

  return { allowed, forbidden: [...forbidden] };
}
