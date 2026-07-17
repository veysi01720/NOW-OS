export interface BundleManifest {
  bundle_version: string;
  bundle_hash: string;
  source_import_ids: string[];
  approved_candidate_count: number;
  rejected_candidate_count: number;
  pending_candidate_count: number;
  conflict_count: number;
  module_count: number;
  document_count: number;
  created_at: string;
  publish_status: "NOT_PUBLISHED" | "PUBLISHED";
  publish_ready: boolean;
  previous_bundle_version: string | null;
}

export interface PreflightReport {
  archive_hash: string;
  archive_size: number;
  file_count: number;
  extensions: string[];
  mime_types: string[];
  nested_archives: number;
  duplicate_content_count: number;
  supported_content_count: number;
  metadata_only_count: number;
  rejected_count: number;
  estimated_extracted_size: number;
}
