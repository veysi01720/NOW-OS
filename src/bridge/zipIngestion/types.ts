export type ZipIngestionJobStatus =
  | "received"
  | "running"
  | "completed"
  | "failed"
  | "duplicate";

export type ZipEntryStatus = "accepted" | "rejected" | "metadata_only";

export type ZipLearningCandidateType =
  | "app_fact_candidate"
  | "faq_candidate"
  | "workflow_candidate"
  | "style_rule_candidate"
  | "escalation_rule_candidate"
  | "link_candidate"
  | "raw_reference"
  | "unknown";

export interface ZipIngestionLimits {
  maxZipBytes: number;
  maxFiles: number;
  maxExtractedBytes: number;
  maxEntryBytes: number;
  processTimeoutSeconds: number;
}

export interface ZipIngestionJobRecord {
  id: string;
  created_at: string;
  updated_at: string;
  sender_role: "owner" | "manager";
  sender_masked: string;
  source_channel: "whatsapp";
  source_instance: string;
  original_filename: string;
  zip_sha256: string;
  zip_size_bytes: number;
  status: ZipIngestionJobStatus;
  status_reason: string;
  total_entries: number;
  accepted_entries: number;
  rejected_entries: number;
  extracted_text_records: number;
  media_records: number;
  duplicate_of_job_id: string | null;
  manifest_path: string;
  approved_for_review: boolean;
}

export interface ZipIngestionEntryRecord {
  id: string;
  job_id: string;
  original_path: string;
  sanitized_path: string;
  extension: string;
  mime_guess: string;
  size_bytes: number;
  sha256: string;
  status: ZipEntryStatus;
  reject_reason: string;
  extracted_text_length: number;
  parser_used: string;
}

export interface ZipLearningCandidateRecord {
  id: string;
  source: "zip_ingestion";
  source_job_id: string;
  source_entry_id: string;
  candidate_type: ZipLearningCandidateType;
  extracted_text: string;
  status: "pending_owner_review" | "approved_for_bundle" | "rejected" | "needs_edit";
  confidence: number;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
  reviewed_by?: "owner" | "manager" | null;
  reviewed_at?: string | null;
  review_decision?: "approve" | "reject" | "needs_edit" | null;
  review_note_sanitized?: string | null;
  conflict_flags?: string[];
  risk_flags?: string[];
  recommended_action?: string;
}

export interface ZipIngestionManifest {
  job_id: string;
  original_filename: string;
  zip_sha256: string;
  created_at: string;
  sender_role: "owner" | "manager";
  source_instance: string;
  total_entries: number;
  accepted_entries: number;
  rejected_entries: number;
  reject_reasons_summary: Record<string, number>;
  extracted_text_records: number;
  media_records: number;
  candidate_count: number;
  duplicate_detected: boolean;
  safety_flags: string[];
  knowledge_modified: false;
  vector_modified: false;
  publish_triggered: false;
  status: ZipIngestionJobStatus;
}

export interface ZipIngestionStoreData {
  schema_version: "1.0";
  jobs: Record<string, ZipIngestionJobRecord>;
  entries: Record<string, ZipIngestionEntryRecord>;
  learning_candidates: Record<string, ZipLearningCandidateRecord>;
}

export interface ZipProcessResult {
  job: ZipIngestionJobRecord;
  entries: ZipIngestionEntryRecord[];
  candidates: ZipLearningCandidateRecord[];
  manifest: ZipIngestionManifest;
}
