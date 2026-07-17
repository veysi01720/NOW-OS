import type { SenderRole } from "../config/roles.js";
import type { VersionConfig } from "../config/versions.js";
import type { UserState } from "../storage/types.js";

export type ChatType = "private" | "group";

export interface KnowledgeSyncContext {
  approved_ready_count: number;
  pending_sync_count: number;
  synced_count: number;
  failed_count: number;
  skipped_count: number;
  latest_sync_activity_at?: string;
  sync_preview: Array<{
    patch_ref: string;
    source_suggestion_ref: string;
    proposed_section: string;
    sanitized_title: string;
    sanitized_content_preview: string;
    knowledge_type: string;
    confidence: number;
    sync_status: string;
  }>;
  action_result?: {
    action: string;
    success: boolean;
    message: string;
    patch_ref?: string;
    previous_status?: string;
    new_status?: string;
  };
  allowed_actions: string[];
  data_quality_notes: string[];
}

export interface KnowledgePublishContext {
  publish_ready: boolean;
  current_source_hash_masked: string;
  last_published_hash_masked: string;
  publish_needed: boolean;
  last_publish_status: string;
  latest_publish_activity_at?: string;
  publish_preview: {
    source_target: string;
    source_version: string;
    sanitized_item_count: number;
    source_hash_masked: string;
    safety_scan_status: string;
    publish_needed: boolean;
  };
  action_result?: {
    action: string;
    previous_status?: string;
    new_status?: string;
    success: boolean;
    mode: "mock" | "real";
    real_openai_publish: boolean;
    message: string;
    openai_file_id_masked?: string;
    vector_store_id_masked?: string;
  };
  allowed_actions: string[];
  data_quality_notes: string[];
}

export interface LearningReviewContext {
  pending_count: number;
  approved_count: number;
  rejected_count: number;
  archived_count: number;
  latest_pending_suggestions: Array<{
    suggestion_ref: string;
    platform: string;
    class: string;
    evidence_preview_sanitized: string;
    proposed_knowledge_type: string;
    proposed_text_sanitized: string;
    confidence: number;
    created_at: string;
  }>;
  selected_suggestion_detail?: {
    suggestion_ref: string;
    platform: string;
    class: string;
    evidence_preview_sanitized: string;
    proposed_knowledge_type: string;
    proposed_text_sanitized: string;
    confidence: number;
    status: string;
    created_at: string;
  };
  action_result?: {
    action: string;
    suggestion_ref: string;
    previous_status: string;
    new_status: string;
    success: boolean;
    message: string;
    mode?: string;
    real_openai_publish?: boolean;
  };
  allowed_actions: string[];
  data_quality_notes: string[];
}

export interface StructuredFactsContext {
  app_facts_source_status: "loaded" | "missing" | "invalid";
  app_facts_source_hash: string | null;
  app_facts: Array<{
    app: string;
    android_name: string;
    ios_name: string;
    invite_code: string | null;
    agency_bind_code: string | null;
    agency_code: string | null;
    official_url: string | null;
    status: string;
    aliases: string[];
    capabilities: {
      text_only: boolean;
      video_required: boolean | null;
    };
  }>;
  errors: string[];
}

export interface OwnerReportSummary {
  generated_at: string;
  total_candidates: number;
  active_candidates: number;
  new_leads_count: number;
  waiting_selected_app_count: number;
  waiting_phone_type_count: number;
  ready_for_installation_count: number;
  open_missing_info_count: number;
  open_follow_up_count: number;
  high_priority_count: number;
  support_signal_count: number;
  payment_or_trust_question_count: number;
  total_publishers: number;
  active_publishers: number;
  inactive_publishers: number;
  training_pending_count: number;
  installation_pending_count: number;
  support_needed_count: number;
  payment_question_count: number;
  active_groups_count: number;
  group_support_signal_count: number;
  group_training_question_count: number;
  group_installation_question_count: number;
  group_payment_or_trust_question_count: number;
  group_rule_violation_count: number;
  top_group_followups: Array<{
    sender_masked: string;
    reason: string;
    priority: string;
    current_state: string;
    missing_fields: string[];
    last_user_message_preview: string;
    suggested_operator_action: string;
    last_seen_at: string;
  }>;
  ingestion_jobs_count: number;
  last_ingestion_status: string;
  pending_learning_suggestions_count: number;
  approved_learning_suggestions_count: number;
  rejected_learning_suggestions_count: number;
  archived_learning_suggestions_count: number;
  latest_learning_review_activity_at: string | null;
  approved_ready_for_sync_count: number;
  knowledge_patches_pending_count: number;
  knowledge_patches_synced_count: number;
  knowledge_patches_failed_count: number;
  latest_knowledge_sync_at: string | null;
  knowledge_publish_ready: boolean;
  last_knowledge_publish_status: string;
  latest_knowledge_publish_at: string | null;
  knowledge_publish_needed: boolean;
  unpublished_knowledge_changes_count: number;
  support_patterns_found_count: number;
  payment_trust_patterns_found_count: number;
  complaint_risk_patterns_found_count: number;
  top_publisher_followups: Array<{
    sender_masked: string;
    reason: string;
    priority: string;
    current_state: string;
    missing_fields: string[];
    last_user_message_preview: string;
    suggested_operator_action: string;
    last_seen_at: string;
  }>;
  top_priority_items: Array<{
    sender_masked: string;
    reason: string;
    priority: string;
    current_state: string;
    missing_fields: string[];
    last_user_message_preview: string;
    suggested_operator_action: string;
    last_seen_at: string;
  }>;
  suggested_owner_actions: string[];
  data_quality_notes: string[];
}

export interface DailyOwnerReportSummary {
  report_date: string;
  timezone: string;
  generated_at: string;
  delivery_mode: string;
  duplicate_status: string;
  candidate_summary: {
    total_candidates: number;
    new_leads_count: number;
    waiting_selected_app_count: number;
    waiting_phone_type_count: number;
    ready_for_installation_count: number;
  };
  publisher_summary: {
    total_publishers: number;
    active_publishers: number;
    inactive_publishers: number;
    training_pending_count: number;
    installation_pending_count: number;
    support_needed_count: number;
  };
  queue_summary: {
    open_follow_up_count: number;
    open_missing_info_count: number;
    high_priority_count: number;
    support_signal_count: number;
    payment_or_trust_question_count: number;
  };
  group_summary: {
    group_support_signal_count: number;
    group_training_question_count: number;
    group_installation_question_count: number;
    group_rule_violation_count: number;
    top_group_followups: Array<{
      sender_masked: string;
      reason: string;
      priority: string;
      last_user_message_preview: string;
      suggested_operator_action: string;
    }>;
  };
  learning_summary: {
    pending_learning_suggestions_count: number;
    approved_learning_suggestions_count: number;
    rejected_learning_suggestions_count: number;
    archived_learning_suggestions_count: number;
  };
  knowledge_summary: {
    knowledge_patches_synced_count: number;
    latest_knowledge_sync_at: string | null;
    last_knowledge_publish_status: string;
    file_search_retrieval_ready: boolean;
  };
  production_summary: {
    maintenance_mode: boolean;
    webhook_health: string;
    backup_available: boolean;
    security_scan_status: string;
    real_publish_flag_enabled: boolean;
    blockers: string[];
  };
  suggested_actions: string[];
  data_quality_notes: string[];
}

export interface BackendContextPayloadV1 {
  backend_context_version: "1.0";
  correlation_id: string;
  sender_role: SenderRole;
  chat_type: ChatType;
  sender: {
    sender_id: string;
    display_name?: string;
    phone_number: string;
  };
  chat: {
    remote_jid: string;
    message_id: string;
    message_type: string;
    is_from_me: boolean;
    is_group: boolean;
  };
  allowed_apps: string[];
  state: UserState;
  memory: {
    conversation_summary: string;
    last_5_user_messages: string[];
    last_5_bot_replies: string[];
    last_10_messages: string[];
    last_intent?: string | null;
    summary?: string | null;
  };
  versions: VersionConfig;
  report_summary?: OwnerReportSummary;
  daily_report?: DailyOwnerReportSummary;
  group?: {
    group_signal?: string;
    group_queue_summary?: string;
    group_safe_mode: boolean;
  };
  learning_review?: LearningReviewContext;
  knowledge_sync?: KnowledgeSyncContext;
  knowledge_publish?: KnowledgePublishContext;
  answer_plan?: any;
  structured_facts?: StructuredFactsContext;
  behavior_context?: any;
  conversation_decision_v2?: unknown;
  conversation_decision_v2_instructions?: string;
  owner_instruction_override?: {
    rule: string;
    supported_intents: string[];
  };
  candidate_instruction_override?: {
    reply_style: string;
    last_question_priority: boolean;
    repetition_guard: boolean;
  };
  user_message: {
    text: string;
    received_at: string;
  };
}
