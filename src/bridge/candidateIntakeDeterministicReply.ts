import type { CandidateStateMachineResult } from "./candidateIntakeStateMachine.js";
import type { ConversationDecisionAction, ConversationDecisionNextAction } from "../intelligence/conversation/ConversationDecisionSchema.js";

export type CandidateIntakeDeterministicReplyOrigin =
  | "deterministic_partial_intake_fast_path"
  | "deterministic_model_acceptance_fast_path"
  | "deterministic_app_selection_fast_path"
  | "deterministic_phone_type_capture_fast_path"
  | "deterministic_installation_start_fast_path";

export interface CandidateIntakeDeterministicReply {
  text: string;
  origin: CandidateIntakeDeterministicReplyOrigin;
  chosen_actions: ConversationDecisionAction[];
  next_action: ConversationDecisionNextAction;
  state_patch_fields: string[];
}

function nextMissingCoreField(result: CandidateStateMachineResult): "age" | "gender" | "daily_hours" | null {
  for (const field of ["age", "gender", "daily_hours"] as const) {
    if (result.next_state.missing_fields.includes(field)) return field;
  }
  return null;
}

function appPrompt(result: CandidateStateMachineResult): string {
  if (result.next_state.selected_app === null && result.next_state.phone_type === null) {
    return "Hangi onayli uygulama ile ve hangi telefon tipiyle ilerleyelim?";
  }
  if (result.next_state.selected_app === null) {
    return "Hangi onayli uygulama ile ilerleyelim?";
  }
  return "Telefonun Android mi, iPhone mu?";
}

/**
 * Captures that have an unambiguous next question must not be delegated to
 * the model. Work-model disclosure remains model-owned because it requires
 * grounded explanation rather than field collection.
 */
export function buildCandidateIntakeDeterministicReply(
  result: CandidateStateMachineResult,
): CandidateIntakeDeterministicReply | null {
  if (!result.applied || result.sender_role !== "candidate" || result.previous_state.current_state === "ELIGIBILITY_RESOLVED") {
    return null;
  }

  const captured = new Set(result.captured_fields);
  const missingCore = nextMissingCoreField(result);
  if (captured.has("age") || captured.has("gender") || captured.has("daily_hours")) {
    if (missingCore !== null) {
      const question = missingCore === "age"
        ? "Yasini yazar misin?"
        : missingCore === "gender"
          ? "Cinsiyetin nedir?"
          : "Gunde ortalama kac saat ayirabilirsin?";
      return {
        text: `Bilgini aldim. ${question}`,
        origin: "deterministic_partial_intake_fast_path",
        chosen_actions: [
          "acknowledge_information",
          missingCore === "age" ? "ask_missing_age" : missingCore === "gender" ? "ask_missing_gender" : "ask_missing_daily_hours",
        ],
        next_action: "ask_missing_info",
        state_patch_fields: result.captured_fields,
      };
    }
    // The next stage is grounded work-model disclosure, not a field capture.
    return null;
  }

  if (captured.has("model_acceptance")) {
    if (result.next_state.model_acceptance === "accepted") {
      return {
        text: `Calisma modelini kabul ettigini kaydettim. ${appPrompt(result)}`,
        origin: "deterministic_model_acceptance_fast_path",
        chosen_actions: [
          "acknowledge_information",
          "record_work_model_acceptance",
          ...(result.next_state.selected_app === null ? ["ask_selected_app" as const] : []),
          ...(result.next_state.phone_type === null ? ["ask_phone_type" as const] : []),
        ],
        next_action: "update_candidate_state",
        state_patch_fields: result.captured_fields,
      };
    }
    if (result.next_state.model_acceptance === "rejected") {
      return {
        text: "Anladim; bu calisma modelini kabul etmedigini kaydettim. Hangi noktayi netlestireyim?",
        origin: "deterministic_model_acceptance_fast_path",
        chosen_actions: ["acknowledge_information", "record_work_model_acceptance"],
        next_action: "update_candidate_state",
        state_patch_fields: result.captured_fields,
      };
    }
  }

  if (captured.has("selected_app") || captured.has("phone_type")) {
    if (result.next_state.current_state === "INSTALLATION_IN_PROGRESS") {
      const phoneLabel = result.next_state.phone_type === "ios" ? "iPhone/iOS" : "Android";
      return {
        text: `${result.next_state.selected_app ?? "Uygulama"} ve ${phoneLabel} bilgilerini aldim. Kurulum adimlarina gecebiliriz.`,
        origin: "deterministic_installation_start_fast_path",
        chosen_actions: ["acknowledge_information", "begin_setup", "provide_installation_instruction"],
        next_action: "update_candidate_state",
        state_patch_fields: [...result.captured_fields, "installation_status"],
      };
    }
    if (captured.has("selected_app") && result.next_state.phone_type === null) {
      return {
        text: `${result.next_state.selected_app} bilgisini aldim. Telefonun Android mi, iPhone mu?`,
        origin: "deterministic_app_selection_fast_path",
        chosen_actions: ["acknowledge_information", "ask_phone_type"],
        next_action: "ask_missing_info",
        state_patch_fields: result.captured_fields,
      };
    }
    if (captured.has("phone_type") && result.next_state.selected_app === null) {
      const phoneLabel = result.next_state.phone_type === "ios" ? "iPhone/iOS" : "Android";
      return {
        text: `${phoneLabel} bilgisini aldim. ${appPrompt(result)}`,
        origin: "deterministic_phone_type_capture_fast_path",
        chosen_actions: ["acknowledge_information", "ask_selected_app"],
        next_action: "ask_missing_info",
        state_patch_fields: result.captured_fields,
      };
    }
  }

  return null;
}
