export interface CandidateMetrics {
  total_candidates: number;
  active_candidates: number;
  installation_pending: number;
  training_pending: number;
  missing_info_count: number;
  converted_to_publisher_count: number;
  blocked_rejected_count: number;
  average_time_to_first_followup: number;
  average_time_to_conversion: number;
}

export interface PublisherMetrics {
  total_publishers: number;
  active_publishers: number;
  inactive_publishers: number;
  support_needed_count: number;
  paused_count: number;
  training_pending_count: number;
  installation_pending_count: number;
  status_change_count: number;
  top_attention_needed_publishers: string[]; // safe_ref only
}

export interface QueueMetrics {
  open_queue_count: number;
  resolved_queue_count: number;
  overdue_followups_count: number;
  queue_by_type: Record<string, number>;
  average_resolution_time: number;
}

export interface LearningMetrics {
  pending_owner_review_count: number;
  approved_count: number;
  rejected_count: number;
  archived_count: number;
  ingestion_generated_learning_count: number;
  approval_rate: number;
}

export interface IngestionMetrics {
  total_ingestion_jobs: number;
  imported_count: number;
  skipped_duplicate_count: number;
  rejected_count: number;
  failed_jobs: number;
  partial_jobs: number;
  platform_summary: Record<string, number>;
  data_quality_notes: string[];
}

export interface ReportMetrics {
  scheduled_report_runs: number;
  preview_count: number;
  sent_count: number;
  blocked_count: number;
  failed_count: number;
  last_run_status: string;
}

export interface SocialIntakeMetrics {
  total_leads: number;
  pending_review: number;
  reviewed: number;
  converted: number;
  archived: number;
}

export interface DashboardActionMetrics {
  action_count_by_type: Record<string, number>;
  blocked_action_count: number;
  idempotency_duplicate_count: number;
  risky_action_count: number;
  owner_vs_manager_action_summary: Record<string, number>;
}

export interface AnalyticsSnapshotV1 {
  snapshot_ref: string;
  generated_at: string;
  period_start: string;
  period_end: string;
  period_label: string;
  health_score: {
    score: number;
    status: 'good' | 'watch' | 'critical';
    reasons_sanitized: string[];
  };
  candidate_metrics: CandidateMetrics;
  publisher_metrics: PublisherMetrics;
  queue_metrics: QueueMetrics;
  learning_metrics: LearningMetrics;
  ingestion_metrics: IngestionMetrics;
  report_metrics: ReportMetrics;
  dashboard_action_metrics: DashboardActionMetrics;
  social_intake_metrics?: SocialIntakeMetrics;
  data_quality_notes: string[];
  suggested_focus_areas: string[];
}
