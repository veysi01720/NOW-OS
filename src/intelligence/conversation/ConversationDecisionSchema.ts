import type { UserState } from "../../storage/types.js";

export type ConversationDecisionAction =
  | "answer_user_question"
  | "clarify_previous_explanation"
  | "acknowledge_information"
  | "ask_missing_age"
  | "ask_missing_gender"
  | "ask_missing_daily_hours"
  | "explain_work_model"
  | "request_work_model_acceptance"
  | "record_work_model_acceptance"
  | "ask_selected_app"
  | "ask_phone_type"
  | "begin_setup"
  | "provide_installation_instruction"
  | "clarify_ambiguous_input"
  | "escalate_policy_missing"
  | "respond_to_off_topic_question"
  | "handle_user_frustration";

export interface ConversationPolicyFact {
  id: string;
  topic: string;
  fact: string;
  content: string;
  source: "canonical_policy" | "knowledge_bank";
  version: string;
}

export interface ConversationDecisionContext {
  request_id: string;
  decision_version: "conversation_v2";
  tenant_id: "now_os";
  instance_id: string;
  channel: "private" | "group";
  role: string;
  latest_message: {
    id: string;
    text: string;
    timestamp: string;
    language: "tr";
    inferred_intent: string | null;
  };
  recent_messages: Array<{ role: "user" | "assistant"; text: string }>;
  candidate_state: {
    age: number | null;
    gender: string | null;
    daily_hours: number | null;
    work_model_acceptance: UserState["model_acceptance"];
    selected_app: string | null;
    phone_type: string | null;
  };
  derived_state: {
    intake_complete: boolean;
    eligibility_status: UserState["eligibility_status"];
    dialogue_phase: string;
  };
  facts_extracted_from_current_message: string[];
  canonical_policy_facts: ConversationPolicyFact[];
  allowed_actions: ConversationDecisionAction[];
  forbidden_actions: ConversationDecisionAction[] | string[];
  runtime_constraints: {
    max_reply_length: number;
    max_questions: number;
    must_answer_direct_question_first: boolean;
    facts_must_be_grounded: boolean;
    behavior_prompt_version: "conversation_behavior_v2.1";
  };
}

export interface ConversationDecision {
  decision_version: "2.0";
  intent: {
    primary: string;
    secondary: string[];
    confidence: number;
  };
  direct_question: {
    present: boolean;
    question_summary: string | null;
    answered_in_reply: boolean;
  };
  reply: {
    text: string;
    language: "tr";
    tone: "natural_concise" | string;
    contains_question: boolean;
  };
  chosen_actions: ConversationDecisionAction[];
  state_patch: {
    age?: number | null;
    gender?: string | null;
    daily_hours?: number | null;
    work_model_acceptance?: "pending" | "accepted" | "rejected" | null;
    selected_app?: string | null;
    phone_type?: string | null;
    work_model_disclosed?: boolean;
  };
  policy_facts_used: string[];
  next_action: ConversationDecisionAction | "none";
  requires_escalation: boolean;
  escalation_reason: string | null;
  risk_flags: string[];
  self_check: {
    answered_latest_message: boolean;
    asked_known_information_again: boolean;
    invented_policy: boolean;
    offered_setup_too_early: boolean;
    used_generic_closing: boolean;
  };
  origin?: "conversation_decision_v2_model" | "conversation_decision_v2_model_repair" | "deterministic_safety_response" | "deterministic_transport_failure";
}

export interface DecisionValidationResult {
  ok: boolean;
  reason_codes: string[];
}
