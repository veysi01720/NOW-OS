import type { EnvConfig } from "../config/env.js";
import type { SenderRole } from "../config/roles.js";
import {
  defaultUserState,
  type PublisherActivityStatus,
  type PublisherStore,
  type UserIdentityInput,
  type UserState,
  type UserStateStore
} from "../storage/types.js";
import { getConversationKey } from "./buildBackendContext.js";
import type { NormalizedIncomingMessage } from "./normalizeEvolutionMessage.js";
import { resolveAuthorityContext, type AuthorityContext } from "./authorityContext.js";
import { applyUserStateTransition } from "../storage/userStateTransitionBoundary.js";

export type CandidateCurrentState =
  | "NEW_LEAD"
  | "WAITING_FOR_APP"
  | "WAITING_FOR_PHONE_TYPE"
  | "READY_FOR_INSTALLATION"
  | "INSTALLATION_IN_PROGRESS"
  | "INSTALLATION_DONE"
  | "TRAINING_READY"
  | "TRAINING_IN_PROGRESS"
  | "TRAINING_DONE"
  | "SUPPORT_NEEDED"
  | "INTAKE_COMPLETE"
  | "ELIGIBILITY_RESOLVED"
  | "WORK_MODEL_DISCLOSURE"
  | "WORK_MODEL_ACCEPTANCE";

export interface CandidateStateMachineResult {
  applied: boolean;
  skipped_reason?: "non_candidate_role" | "non_private_chat" | "missing_state_store";
  sender_role: SenderRole;
  previous_state: UserState;
  next_state: UserState;
  changed_fields: string[];
  captured_fields: string[];
  ignored_unapproved_app: boolean;
  ambiguous_phone_type: boolean;
}

function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/\b(gunde|gunluk)(\d{1,2})\b/gu, "$1 $2 saat")
    .replace(/\byirmi\s+yedi\b/gu, "27")
    .replace(/\bdort\b/gu, "4")
    .replace(/\bdÃ¶rt\b/gu, "4");
}

function sameState(left: UserState, right: UserState): boolean {
  return (
    left.current_state === right.current_state &&
    left.selected_app === right.selected_app &&
    left.phone_type === right.phone_type &&
    left.age === right.age &&
    left.gender === right.gender &&
    left.daily_hours === right.daily_hours &&
    left.previous_platform_experience === right.previous_platform_experience &&
    left.eligibility_status === right.eligibility_status &&
    left.work_model_disclosed === right.work_model_disclosed &&
    left.model_acceptance === right.model_acceptance &&
    left.installation_status === right.installation_status &&
    left.installation_verification_status === right.installation_verification_status &&
    left.training_status === right.training_status &&
    left.expected_next_step === right.expected_next_step &&
    left.missing_fields.length === right.missing_fields.length &&
    left.missing_fields.every((field, index) => field === right.missing_fields[index])
  );
}

function cloneState(state: UserState): UserState {
  return {
    current_state: state.current_state,
    selected_app: state.selected_app,
    phone_type: state.phone_type,
    age: state.age ?? null,
    gender: state.gender ?? null,
    daily_hours: state.daily_hours ?? null,
    previous_platform_experience: state.previous_platform_experience ?? null,
    eligibility_status: state.eligibility_status ?? "unresolved",
    work_model_disclosed: state.work_model_disclosed ?? false,
    model_acceptance: state.model_acceptance ?? null,
    installation_status: state.installation_status,
    installation_verification_status: state.installation_verification_status ?? null,
    training_status: state.training_status,
    missing_fields: [...state.missing_fields],
    expected_next_step: state.expected_next_step
  };
}

function changedFields(previous: UserState, next: UserState): string[] {
  const fields: Array<keyof UserState> = [
    "current_state",
    "selected_app",
    "phone_type",
    "age",
    "gender",
    "daily_hours",
    "previous_platform_experience",
    "eligibility_status",
    "work_model_disclosed",
    "model_acceptance",
    "installation_status",
    "installation_verification_status",
    "training_status",
    "expected_next_step"
  ];
  const changed = fields.filter((field) => previous[field] !== next[field]);

  if (
    previous.missing_fields.length !== next.missing_fields.length ||
    previous.missing_fields.some((field, index) => field !== next.missing_fields[index])
  ) {
    changed.push("missing_fields");
  }

  return changed;
}

export function deriveCandidateState(state: UserState, conversationDecisionV2Enabled = true): UserState {
  const next = cloneState(state);
  if (next.eligibility_status === "ineligible") {
    next.current_state = "ELIGIBILITY_RESOLVED";
    next.missing_fields = [];
    next.expected_next_step = "no_candidate_action";
    return next;
  }
  if (!conversationDecisionV2Enabled) {
    next.missing_fields = [
      ...(next.selected_app === null ? ["selected_app"] : []),
      ...(next.phone_type === null ? ["phone_type"] : [])
    ];

  if (next.selected_app === null && next.phone_type === null) {
    next.current_state = next.model_acceptance === "accepted" ? "WAITING_FOR_APP" : "NEW_LEAD";
      next.expected_next_step = "ask_selected_app_or_phone_type";
      return next;
    }

    if (next.selected_app === null) {
      next.current_state = "WAITING_FOR_APP";
      next.expected_next_step = "ask_selected_app";
      return next;
    }

    if (next.phone_type === null) {
      next.current_state = "WAITING_FOR_PHONE_TYPE";
      next.expected_next_step = "ask_phone_type";
      return next;
    }

    if (next.installation_status === "not_started") {
      next.installation_status = "in_progress";
      next.current_state = "INSTALLATION_IN_PROGRESS";
      next.expected_next_step = "continue_installation";
      return next;
    }
  }

  const intakeMissing = [
    ...(next.age === null ? ["age"] : []),
    ...(next.gender === null ? ["gender"] : []),
    ...(next.daily_hours === null ? ["daily_hours"] : []),
    ...(next.gender === "kadın" && next.previous_platform_experience == null ? ["previous_platform_experience"] : []),
    ...(next.selected_app === null ? ["selected_app"] : []),
    ...(next.phone_type === null ? ["phone_type"] : [])
  ];
  const coreIntakeMissing = next.age === null || next.gender === null || next.daily_hours === null;
  if (coreIntakeMissing) {
    next.current_state = "NEW_LEAD";
    next.missing_fields = intakeMissing;
    next.expected_next_step = "ask_intake_info";
    return next;
  }

  if (next.gender === "kadın" && next.previous_platform_experience == null && next.work_model_disclosed !== true) {
    next.current_state = "NEW_LEAD";
    next.missing_fields = ["previous_platform_experience"];
    next.expected_next_step = "ask_previous_platform_experience";
    return next;
  }

  if (next.eligibility_status === "unresolved" || next.eligibility_status === null || next.eligibility_status === undefined) {
    next.eligibility_status = "eligible";
  }

  if (next.work_model_disclosed !== true) {
    next.current_state = "WORK_MODEL_DISCLOSURE";
    next.missing_fields = ["model_acceptance"];
    next.expected_next_step = "explain_work_model_and_ask_acceptance";
    return next;
  }

  if (next.model_acceptance !== "accepted") {
    next.current_state = "WORK_MODEL_ACCEPTANCE";
    next.missing_fields = ["model_acceptance"];
    next.expected_next_step = "ask_work_model_acceptance";
    return next;
  }

  next.missing_fields = [
    ...(next.selected_app === null ? ["selected_app"] : []),
    ...(next.phone_type === null ? ["phone_type"] : [])
  ];

  if (next.selected_app === null && next.phone_type === null) {
    next.current_state = next.model_acceptance === "accepted" ? "WAITING_FOR_APP" : "NEW_LEAD";
    next.expected_next_step = "ask_selected_app_or_phone_type";
    return next;
  }

  if (next.selected_app === null) {
    next.current_state = "WAITING_FOR_APP";
    next.expected_next_step = "ask_selected_app";
    return next;
  }

  if (next.phone_type === null) {
    next.current_state = "WAITING_FOR_PHONE_TYPE";
    next.expected_next_step = "ask_phone_type";
    return next;
  }

  if (next.installation_status === "not_started") {
    next.installation_status = "in_progress";
    next.current_state = "INSTALLATION_IN_PROGRESS";
    next.expected_next_step = "continue_installation";
    return next;
  }

  if (next.installation_status === "in_progress") {
    next.current_state = "INSTALLATION_IN_PROGRESS";
    next.expected_next_step = "continue_installation";
    return next;
  }

  if (next.installation_status === "done" && next.training_status === "not_started") {
    next.current_state = "TRAINING_READY";
    next.expected_next_step = "start_training";
    return next;
  }

  if (next.training_status === "in_progress") {
    next.current_state = "TRAINING_IN_PROGRESS";
    next.expected_next_step = "continue_training";
    return next;
  }

  if (next.training_status === "done") {
    next.current_state = "TRAINING_DONE";
    next.expected_next_step = "no_candidate_action";
    return next;
  }

  return next;
}

export function detectApprovedApp(text: string, allowedApps: string[]): string | null {
  const normalizedText = normalizeText(text);
  return (
    allowedApps.find((app) => {
      const normalizedApp = normalizeText(app);
      return new RegExp(`(^|[^\\p{L}\\p{N}])${normalizedApp}([^\\p{L}\\p{N}]|$)`, "u").test(normalizedText);
    }) ?? null
  );
}

export function detectPhoneType(text: string): { phone_type: "android" | "ios" | null; ambiguous: boolean } {
  const normalizedText = normalizeText(text);
  const hasAndroid = /\b(android|samsung|xiaomi|huawei|oppo|vivo|redmi|realme)\b/u.test(normalizedText);
  const hasIphone = /\b(iphone|ios|apple)\b/u.test(normalizedText);

  if (hasAndroid && hasIphone) {
    return { phone_type: null, ambiguous: true };
  }

  if (hasAndroid) {
    return { phone_type: "android", ambiguous: false };
  }

  if (hasIphone) {
    return { phone_type: "ios", ambiguous: false };
  }

  return { phone_type: null, ambiguous: false };
}

export function detectModelAcceptance(text: string): "accepted" | "rejected" | null {
  const normalizedText = normalizeText(text);
  if (/\b(kabul|uygun|uygub|tamam|olur|evet|baslayalim|baÅŸlayalim|anladim)\b/u.test(normalizedText)) {
    return "accepted";
  }
  if (/\b(uygun degil|istemiyorum|hayir|vazgectim|kabul etmiyorum)\b/u.test(normalizedText)) {
    return "rejected";
  }
  return null;
}

export interface IntakeDetection extends Partial<Pick<UserState, "age" | "gender" | "daily_hours">> {
  age_rejected?: boolean;
}

export function isAgeEligible(age: number, gender: string | null | undefined): boolean {
  if (age < 18) return false;
  if (gender === "erkek" || gender === "male") return age <= 30;
  if (gender === "kadın" || gender === "female") return age <= 40;
  return false;
}

function hasRecognizedGender(gender: string | null | undefined): boolean {
  return gender === "erkek" || gender === "male" || gender === "kadın" || gender === "female";
}

function isAgeImmediatelyRejected(age: number, gender: string | null | undefined): boolean {
  return age < 18 || (hasRecognizedGender(gender) && !isAgeEligible(age, gender));
}

export function detectPreviousPlatformExperience(text: string): UserState["previous_platform_experience"] {
  const normalizedText = normalizeText(text);
  if (!/(deneyim|tecrube|platform|uygulama|calist|kulland|baslad)/u.test(normalizedText)) return null;
  if (/\b(yok|hic|ilk kez|deneyimim yok|tecrubem yok)\b/u.test(normalizedText)) return "none";
  if (/\b(var|daha once|calistim|kullandim|basladim)\b/u.test(normalizedText)) return "experienced";
  return "unknown";
}

export function detectAgeGenderDailyHours(text: string): IntakeDetection {
  const normalizedText = normalizeText(text);
  const result: IntakeDetection = {};
  if (/\b(erkek[\p{L}\p{N}_]*|erkeg[\p{L}\p{N}_]*|bay|male)\b/u.test(normalizedText)) result.gender = "erkek";
  if (/\b(kadin[\p{L}\p{N}_]*|kadın[\p{L}\p{N}_]*|kadÄ±n[\p{L}\p{N}_]*|bayan|female)\b/u.test(normalizedText)) result.gender = "kadın";
  const ageMatch = normalizedText.match(/(?:^|[^\d])([1-9]\d)(?:\s*(?:yas|yaÅŸ|y))?(?:[^\d]|$)/u);
  if (ageMatch) {
    const age = Number(ageMatch[1]);
    result.age = age;
    result.age_rejected = isAgeImmediatelyRejected(age, result.gender);
  }
  const hourRangeMatch = normalizedText.match(/\b([1-9]|1[0-6])\s*[-/]\s*([1-9]|1[0-6])\s*(?:saat|sa|h)\b/u);
  if (hourRangeMatch) {
    const hours = Number(hourRangeMatch[1]);
    if (hours > 0 && hours <= 16 && hours !== result.age) result.daily_hours = hours;
  }
  const hourMatch = normalizedText.match(/(?:gunde|gÃ¼nlÃ¼k|gunluk)?\s*([1-9]|1[0-6])\s*(?:saat|sa|h)\b/u);
  if (result.daily_hours === undefined && hourMatch) {
    const hours = Number(hourMatch[1]);
    if (hours > 0 && hours <= 16 && hours !== result.age) result.daily_hours = hours;
  }
  const numbers = normalizedText.match(/\b\d{1,2}\b/gu)?.map(Number) ?? [];
  if (result.age === undefined) {
    const age = numbers.find((item) => item >= 10 && item <= 99);
    if (age !== undefined) {
      result.age = age;
      result.age_rejected = isAgeImmediatelyRejected(age, result.gender);
    }
  }
  if (result.daily_hours === undefined && result.gender !== undefined) {
    const hours = numbers.find((item) => item > 0 && item <= 16 && item !== result.age);
    if (hours !== undefined) result.daily_hours = hours;
  }
  return result;
}

export function applyCandidateIntakeStateMachine(
  message: NormalizedIncomingMessage,
  env: EnvConfig,
  userStateStore?: UserStateStore,
  publisherStore?: PublisherStore,
  authorityContext?: AuthorityContext,
): CandidateStateMachineResult {
  const authority = authorityContext ?? resolveAuthorityContext(message, env);
  const senderRole = authority.sender_role;
  const conversationKey = getConversationKey(message);
  const identity: UserIdentityInput = { normalized_phone_or_jid: conversationKey };
  const fallbackState = defaultUserState();

  if (message.chat_type !== "private") {
    return {
      applied: false,
      skipped_reason: "non_private_chat",
      sender_role: senderRole,
      previous_state: fallbackState,
      next_state: fallbackState,
      changed_fields: [],
      captured_fields: [],
      ignored_unapproved_app: false,
      ambiguous_phone_type: false
    };
  }

  if (senderRole !== "candidate") {
    return {
      applied: false,
      skipped_reason: "non_candidate_role",
      sender_role: senderRole,
      previous_state: fallbackState,
      next_state: fallbackState,
      changed_fields: [],
      captured_fields: [],
      ignored_unapproved_app: false,
      ambiguous_phone_type: false
    };
  }

  if (userStateStore === undefined) {
    return {
      applied: false,
      skipped_reason: "missing_state_store",
      sender_role: senderRole,
      previous_state: fallbackState,
      next_state: deriveCandidateState(fallbackState, env.conversationDecisionV2Enabled !== false),
      changed_fields: [],
      captured_fields: [],
      ignored_unapproved_app: false,
      ambiguous_phone_type: false
    };
  }

  const storedState = userStateStore.getOrCreateState(conversationKey, fallbackState, identity);
  if (
    env.conversationDecisionV2Enabled === false &&
    /\b(yoneticiyim|yonetici|manager|mudurum)\b/iu.test(normalizeText(message.text))
  ) {
    return {
      applied: true,
      sender_role: senderRole,
      previous_state: cloneState(storedState),
      next_state: cloneState(storedState),
      changed_fields: [],
      captured_fields: [],
      ignored_unapproved_app: false,
      ambiguous_phone_type: false
    };
  }
  const intake = detectAgeGenderDailyHours(message.text);
  const hasStoredIntake =
    storedState.age !== null ||
    storedState.gender !== null ||
    storedState.daily_hours !== null;
  const hasIncomingIntake =
    intake.age !== undefined ||
    intake.gender !== undefined ||
    intake.daily_hours !== undefined;
  const conversationV2Active = true;
  const previousState = deriveCandidateState(storedState, conversationV2Active);
  const nextState = cloneState(previousState);
  const capturedFields: string[] = [];
  if (conversationV2Active) {
    if (nextState.age === null && intake.age !== undefined) {
      nextState.age = intake.age;
      capturedFields.push("age");
    }
    if (nextState.gender === null && intake.gender !== undefined) {
      nextState.gender = intake.gender;
      capturedFields.push("gender");
    }
    if (nextState.daily_hours === null && intake.daily_hours !== undefined) {
      nextState.daily_hours = intake.daily_hours;
      capturedFields.push("daily_hours");
    }
    if (nextState.gender === "kadın" && nextState.previous_platform_experience == null) {
      const experience = detectPreviousPlatformExperience(message.text);
      if (experience !== null) {
        nextState.previous_platform_experience = experience;
        capturedFields.push("previous_platform_experience");
      }
    }
  }

  if (intake.age_rejected || (nextState.age !== null && isAgeImmediatelyRejected(nextState.age, nextState.gender))) {
    nextState.eligibility_status = "ineligible";
    nextState.current_state = "ELIGIBILITY_RESOLVED";
    nextState.missing_fields = [];
    nextState.expected_next_step = "no_candidate_action";
  }

  if (conversationV2Active && nextState.work_model_disclosed === true && nextState.model_acceptance !== "accepted") {
    const acceptance = detectModelAcceptance(message.text);
    if (acceptance !== null) {
      nextState.model_acceptance = acceptance;
      capturedFields.push("model_acceptance");
    }
  }

  const approvedApp = detectApprovedApp(message.text, env.approvedApps);
  const mentionsAppLikeTerm = /\b(tiktok|instagram|twitch|youtube|sozzy|chatrace|novachat)\b/iu.test(
    normalizeText(message.text)
  );

  if (nextState.selected_app === null && approvedApp !== null) {
    nextState.selected_app = approvedApp;
    capturedFields.push("selected_app");
  }

  const detectedPhone = detectPhoneType(message.text);
  if (nextState.phone_type === null && detectedPhone.phone_type !== null) {
    nextState.phone_type = detectedPhone.phone_type;
    capturedFields.push("phone_type");
  }

  const derivedState = deriveCandidateState(nextState, conversationV2Active);
  const changed = changedFields(previousState, derivedState);

  if (!sameState(storedState, derivedState)) {
    applyUserStateTransition({
      store: userStateStore,
      conversationKey,
      currentState: storedState,
      nextState: derivedState,
      source: "candidate_intake",
      identity,
      authority,
    });
  }

  if (derivedState.selected_app !== null && derivedState.phone_type !== null && publisherStore !== undefined) {
    let activity_status: PublisherActivityStatus = "new";
    if (derivedState.current_state === "READY_FOR_INSTALLATION" || derivedState.current_state === "INSTALLATION_IN_PROGRESS") {
      activity_status = "installation";
    } else if (derivedState.current_state === "INSTALLATION_DONE" || derivedState.current_state === "TRAINING_READY" || derivedState.current_state === "TRAINING_IN_PROGRESS") {
      activity_status = "training";
    } else if (derivedState.current_state === "TRAINING_DONE") {
      activity_status = "ready";
    }

    publisherStore.upsertPublisher({
      user_id: conversationKey,
      display_name: message.push_name ?? "",
      selected_app: derivedState.selected_app,
      phone_type: derivedState.phone_type,
      onboarding_status: derivedState.current_state === "TRAINING_DONE" ? "done" : "in_progress",
      installation_status: derivedState.installation_status === "not_started" ? "pending" : derivedState.installation_status,
      training_status: derivedState.training_status === "not_started" ? "pending" : derivedState.training_status,
      activity_status
    });
  }

  return {
    applied: true,
    sender_role: senderRole,
    previous_state: previousState,
    next_state: derivedState,
    changed_fields: changed,
    captured_fields: capturedFields,
    ignored_unapproved_app: nextState.selected_app === null && approvedApp === null && mentionsAppLikeTerm,
    ambiguous_phone_type: detectedPhone.ambiguous
  };
}
