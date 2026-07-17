export type SupportedPlatform =
  | "whatsapp"
  | "telegram"
  | "instagram"
  | "tiktok"
  | "manual_csv"
  | "manual_json"
  | "unknown";

export type SourceType =
  | "private_chat"
  | "group"
  | "channel"
  | "comment"
  | "dm"
  | "export_file"
  | "unknown";

export type MessageDirection = "inbound" | "outbound" | "unknown";

export interface NormalizedPlatformMessage {
  platform: SupportedPlatform;
  source_type: SourceType;
  source_safe_ref: string; // e.g., SRC-XXXXXX
  sender_safe_ref: string; // e.g., SND-XXXXXX
  sender_role_hint: "candidate" | "operator" | "system" | "unknown";
  message_text_sanitized: string;
  timestamp: string; // ISO 8601
  direction: MessageDirection;
  attachments_meta_sanitized: string[];
  detected_intents: string[];
  risk_flags: string[];
  ingestion_job_ref?: string; // e.g., ING-XXXXXX

  // Safe Context Additions (SPEC-025A)
  campaign_safe_ref?: string;
  source_label_safe?: string;
  import_batch_ref?: string;
  external_context_hash?: string;
}

export interface IngestionJob {
  job_ref: string; // ING-XXXXXX
  platform: string;
  source_type: string;
  status: "pending" | "running" | "completed" | "failed" | "partial";
  started_at: string;
  completed_at?: string;
  imported_count: number;
  skipped_duplicate_count: number;
  rejected_count: number;
  sanitized_error?: string;
  created_by_role: "owner" | "manager" | "system";
  source_label_safe?: string;
  import_batch_ref?: string;
}

export interface ManualImportRow {
  platform?: string;
  source_type?: string;
  source_id?: string;
  sender_id?: string;
  message?: string;
  timestamp?: string;
  direction?: string;
  campaign_id?: string;
  source_label?: string;
}
