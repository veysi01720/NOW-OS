export type IngestionPlatform = "whatsapp" | "instagram" | "telegram" | "tiktok" | "manual_import" | "manual_csv" | "manual_json" | "copy_paste" | "unknown";

export type IngestionJobStatus = "pending" | "running" | "completed" | "failed";

export type IngestionClass = 
  | "candidate_interest"
  | "installation_problem"
  | "training_question"
  | "payment_or_trust_question"
  | "support_signal"
  | "complaint_or_risk"
  | "publisher_activity_signal"
  | "rule_violation"
  | "unknown";

export type LearningSuggestionStatus = "pending_owner_review" | "approved" | "rejected" | "archived";

export type KnowledgeSyncStatus = "pending_sync" | "synced" | "failed" | "skipped";

export type PublishJobStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface NormalizedPlatformMessage {
  platform: IngestionPlatform;
  source_type: string;
  source_id_hash: string;
  sender_id_hash: string;
  sender_role_guess: string;
  chat_type: string;
  message_text_sanitized: string;
  timestamp: string;
  external_message_id_hash: string;
  thread_id_hash: string;
  metadata_sanitized: Record<string, unknown>;
}

export interface IngestionJob {
  job_id: string;
  platform: IngestionPlatform;
  source_type: string;
  status: IngestionJobStatus;
  started_at: string;
  finished_at?: string;
  total_messages_seen: number;
  total_messages_ingested: number;
  total_duplicates_skipped: number;
  total_learning_suggestions_created: number;
  errors_sanitized: string[];
  created_by_role: string;
  source_label_safe?: string;
  import_batch_ref?: string;
}

export interface LearningSuggestion {
  suggestion_id: string;
  short_ref?: string;
  safe_ref?: string;
  source_job_id: string;
  platform: IngestionPlatform;
  suggestion_class: IngestionClass;
  evidence_preview_sanitized: string;
  proposed_knowledge_type: string;
  proposed_text: string;
  confidence: number;
  status: LearningSuggestionStatus;
  created_at: string;
  reviewed_by?: string;
  reviewed_at?: string;
  
  // SPEC-025D Ingestion to Learning Source Tracking
  source_type?: string;
  source_message_safe_ref?: string;
  source_label_safe?: string;
  import_batch_ref?: string;
  suggested_category?: string;
}

export type LearningSuggestionUpsertInput = Omit<LearningSuggestion, "suggestion_id" | "status" | "created_at" | "reviewed_by" | "reviewed_at" | "safe_ref"> & {
  safe_ref?: string;
};

export interface KnowledgePatch {
  knowledge_patch_id: string;
  patch_ref: string;
  source_suggestion_ref: string;
  source_suggestion_id_internal: string;
  proposed_section: string;
  sanitized_title: string;
  sanitized_content: string;
  knowledge_type: string;
  confidence: number;
  created_at: string;
  created_by_role: string;
  sync_status: KnowledgeSyncStatus;
  synced_at?: string;
  sync_target?: string;
  audit_note?: string;
}

export interface PublishJob {
  publish_job_id: string;
  source_target: string;
  source_hash: string;
  source_version?: string;
  publish_status: PublishJobStatus;
  publish_mode: "mock" | "real";
  created_at: string;
  started_at?: string;
  completed_at?: string;
  actor_role: string;
  openai_file_id_masked?: string;
  vector_store_id_masked?: string;
  assistant_id_masked?: string;
  published_file_hash?: string;
  audit_note?: string;
  sanitized_error_if_any?: string;
}
