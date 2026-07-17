import { AnalyticsSnapshotV1, CandidateMetrics, PublisherMetrics, QueueMetrics, LearningMetrics, IngestionMetrics, ReportMetrics, DashboardActionMetrics } from "./analyticsTypes.js";
import { DashboardDeps } from "../bridge/dashboardRoutes.js";

function getPeriodStart(period: string, nowMs: number): number {
  if (period === 'today') {
    return nowMs - 24 * 60 * 60 * 1000;
  }
  if (period === '30d') {
    return nowMs - 30 * 24 * 60 * 60 * 1000;
  }
  // Default to 7d
  return nowMs - 7 * 24 * 60 * 60 * 1000;
}

export function buildAnalyticsSnapshot({ period, deps, nowMs }: { period: string; deps: DashboardDeps; nowMs?: number }): AnalyticsSnapshotV1 {
  const ts = nowMs || Date.now();
  const validPeriod = ['today', '7d', '30d'].includes(period) ? period : '7d';
  const periodStart = getPeriodStart(validPeriod, ts);
  
  const dataQualityNotes: string[] = [];
  if (!['today', '7d', '30d'].includes(period) && period !== undefined) {
    dataQualityNotes.push(`Invalid period '${period}' requested. Fallback to 7d used.`);
  }

  const snapshot: AnalyticsSnapshotV1 = {
    snapshot_ref: `analytics_snap_${ts}`,
    generated_at: new Date(ts).toISOString(),
    period_start: new Date(periodStart).toISOString(),
    period_end: new Date(ts).toISOString(),
    period_label: validPeriod,
    health_score: { score: 100, status: 'good', reasons_sanitized: [] },
    candidate_metrics: {
      total_candidates: 0,
      active_candidates: 0,
      installation_pending: 0,
      training_pending: 0,
      missing_info_count: 0,
      converted_to_publisher_count: 0,
      blocked_rejected_count: 0,
      average_time_to_first_followup: 0,
      average_time_to_conversion: 0
    },
    publisher_metrics: {
      total_publishers: 0,
      active_publishers: 0,
      inactive_publishers: 0,
      support_needed_count: 0,
      paused_count: 0,
      training_pending_count: 0,
      installation_pending_count: 0,
      status_change_count: 0,
      top_attention_needed_publishers: []
    },
    queue_metrics: {
      open_queue_count: 0,
      resolved_queue_count: 0,
      overdue_followups_count: 0,
      queue_by_type: {},
      average_resolution_time: 0
    },
    learning_metrics: {
      pending_owner_review_count: 0,
      approved_count: 0,
      rejected_count: 0,
      archived_count: 0,
      ingestion_generated_learning_count: 0,
      approval_rate: 0
    },
    ingestion_metrics: {
      total_ingestion_jobs: 0,
      imported_count: 0,
      skipped_duplicate_count: 0,
      rejected_count: 0,
      failed_jobs: 0,
      partial_jobs: 0,
      platform_summary: {},
      data_quality_notes: []
    },
    report_metrics: {
      scheduled_report_runs: 0,
      preview_count: 0,
      sent_count: 0,
      blocked_count: 0,
      failed_count: 0,
      last_run_status: 'unknown'
    },
    dashboard_action_metrics: {
      action_count_by_type: {},
      blocked_action_count: 0,
      idempotency_duplicate_count: 0,
      risky_action_count: 0,
      owner_vs_manager_action_summary: {}
    },
    social_intake_metrics: {
      total_leads: 0,
      pending_review: 0,
      reviewed: 0,
      converted: 0,
      archived: 0
    },
    data_quality_notes: dataQualityNotes,
    suggested_focus_areas: []
  };

  // 1. Candidate Metrics
  if (deps.reportDataSource?.listCandidateStates) {
    const candidates = deps.reportDataSource.listCandidateStates();
    snapshot.candidate_metrics.total_candidates = candidates.length;
    for (const c of candidates) {
      if (c.current_state === 'pending_contact' || c.current_state === 'contacted') {
        snapshot.candidate_metrics.active_candidates++;
      }
      if (c.current_state === 'missing_info') snapshot.candidate_metrics.missing_info_count++;
      if (c.current_state === 'blocked' || c.current_state === 'rejected') snapshot.candidate_metrics.blocked_rejected_count++;
    }
  } else {
    snapshot.data_quality_notes.push("No candidate data available.");
  }

  // 2. Publisher Metrics
  if (deps.reportDataSource?.listPublishers) {
    const publishers = deps.reportDataSource.listPublishers();
    snapshot.publisher_metrics.total_publishers = publishers.length;
    for (const p of publishers) {
      const status = (p as any).status || 'unknown'; // Optional status field from some source? 
      if (status === 'active') snapshot.publisher_metrics.active_publishers++;
      if (status === 'inactive') snapshot.publisher_metrics.inactive_publishers++;
      if (status === 'support_needed') snapshot.publisher_metrics.support_needed_count++;
      if (status === 'paused') snapshot.publisher_metrics.paused_count++;
    }
  }

  // 3. Queue Metrics
  if (deps.reportDataSource?.listQueueItems) {
    const qitems = deps.reportDataSource.listQueueItems();
    for (const q of qitems) {
      if ((q as any).current_state === 'open' || !(q as any).current_state) {
        snapshot.queue_metrics.open_queue_count++;
      } else if ((q as any).current_state === 'resolved') {
        snapshot.queue_metrics.resolved_queue_count++;
      }
      snapshot.queue_metrics.queue_by_type[q.reason] = (snapshot.queue_metrics.queue_by_type[q.reason] || 0) + 1;
    }
  }

  // 4. Learning Metrics
  if (deps.reportDataSource?.listLearningSuggestions) {
    const learnings = deps.reportDataSource.listLearningSuggestions();
    for (const l of learnings) {
      if (l.status === 'pending_owner_review') snapshot.learning_metrics.pending_owner_review_count++;
      if (l.status === 'approved') snapshot.learning_metrics.approved_count++;
      if (l.status === 'rejected') snapshot.learning_metrics.rejected_count++;
      if (l.status === 'archived') snapshot.learning_metrics.archived_count++;
      if (l.source_job_id) snapshot.learning_metrics.ingestion_generated_learning_count++;
    }
    const decided = snapshot.learning_metrics.approved_count + snapshot.learning_metrics.rejected_count;
    snapshot.learning_metrics.approval_rate = decided > 0 ? (snapshot.learning_metrics.approved_count / decided) * 100 : 0;
  }

  // 5. Ingestion Metrics
  if (deps.reportDataSource?.listIngestionJobs) {
    const jobs = deps.reportDataSource.listIngestionJobs();
    snapshot.ingestion_metrics.total_ingestion_jobs = jobs.length;
    for (const j of jobs) {
      if (new Date(j.started_at).getTime() < periodStart) continue;

      if (j.status === 'failed') snapshot.ingestion_metrics.failed_jobs++;
      if (j.status === 'completed') {
        if (j.total_duplicates_skipped > 0 && j.total_messages_ingested < j.total_messages_seen) {
          snapshot.ingestion_metrics.partial_jobs++;
        }
      }
      snapshot.ingestion_metrics.imported_count += (j.total_messages_ingested || 0);
      snapshot.ingestion_metrics.skipped_duplicate_count += (j.total_duplicates_skipped || 0);
      snapshot.ingestion_metrics.platform_summary[j.platform] = (snapshot.ingestion_metrics.platform_summary[j.platform] || 0) + 1;
    }
  }

  // 6. Report Metrics
  if (deps.scheduledReportRunStore) {
    const runs = deps.scheduledReportRunStore.getRuns(100);
    for (const r of runs) {
      if (new Date(r.generated_at).getTime() < periodStart) continue;
      snapshot.report_metrics.scheduled_report_runs++;
      if (r.target_mode === 'preview') snapshot.report_metrics.preview_count++;
      if (r.target_mode === 'whatsapp') snapshot.report_metrics.sent_count++;
      if (r.status === 'blocked') snapshot.report_metrics.blocked_count++;
      if (r.status === 'failed') snapshot.report_metrics.failed_count++;
    }
    if (runs.length > 0) {
      snapshot.report_metrics.last_run_status = runs[0].status;
    }
  }

  // 7. Dashboard Action Metrics
  if (deps.actionAuditStore) {
    const actions = deps.actionAuditStore.getRecentLogs(500);
    for (const a of actions) {
      if (new Date(a.created_at).getTime() < periodStart) continue;
      snapshot.dashboard_action_metrics.action_count_by_type[a.action_type] = (snapshot.dashboard_action_metrics.action_count_by_type[a.action_type] || 0) + 1;
      if (a.result_status === 'failure') snapshot.dashboard_action_metrics.blocked_action_count++;
      if (a.result_status === 'skipped_duplicate') snapshot.dashboard_action_metrics.idempotency_duplicate_count++;
      if (a.actor_role) {
        snapshot.dashboard_action_metrics.owner_vs_manager_action_summary[a.actor_role] = (snapshot.dashboard_action_metrics.owner_vs_manager_action_summary[a.actor_role] || 0) + 1;
      }
      // Note: we can map "risky" actions via known strings if we want, but for V1 we just track blocked.
    }
  }

  // 7b. Social Intake Metrics
  if (deps.socialLeadStore) {
    const metrics = deps.socialLeadStore.getMetrics();
    snapshot.social_intake_metrics = {
      total_leads: metrics.total_social_leads,
      pending_review: metrics.pending_review_count,
      reviewed: metrics.reviewed_count,
      converted: metrics.converted_to_candidate_count,
      archived: metrics.archived_count
    };
  }

  // 8. Health Score Calculation (Deterministic)
  let penalty = 0;
  const reasons: string[] = [];

  if (snapshot.queue_metrics.overdue_followups_count > 0) {
    penalty += Math.min(20, snapshot.queue_metrics.overdue_followups_count * 5);
    reasons.push(`${snapshot.queue_metrics.overdue_followups_count} overdue follow-ups detected.`);
  }

  if (snapshot.ingestion_metrics.failed_jobs > 0) {
    penalty += Math.min(30, snapshot.ingestion_metrics.failed_jobs * 10);
    reasons.push(`${snapshot.ingestion_metrics.failed_jobs} failed ingestion jobs.`);
  }

  if (snapshot.learning_metrics.pending_owner_review_count > 10) {
    penalty += 10;
    reasons.push(`High learning review backlog (${snapshot.learning_metrics.pending_owner_review_count} pending).`);
  }

  if (snapshot.publisher_metrics.support_needed_count > 0) {
    penalty += Math.min(20, snapshot.publisher_metrics.support_needed_count * 10);
    reasons.push(`${snapshot.publisher_metrics.support_needed_count} publishers require support.`);
  }

  if (snapshot.report_metrics.failed_count > 0) {
    penalty += 20;
    reasons.push(`${snapshot.report_metrics.failed_count} failed scheduled reports.`);
  }

  let finalScore = 100 - penalty;
  if (finalScore < 0) finalScore = 0;

  snapshot.health_score.score = finalScore;
  if (finalScore >= 80) snapshot.health_score.status = 'good';
  else if (finalScore >= 50) snapshot.health_score.status = 'watch';
  else snapshot.health_score.status = 'critical';

  snapshot.health_score.reasons_sanitized = reasons;

  // 9. Suggested Focus Areas
  if (snapshot.queue_metrics.overdue_followups_count > 0) {
    snapshot.suggested_focus_areas.push(`Queue review needed: ${snapshot.queue_metrics.overdue_followups_count} overdue followups.`);
  }
  if (snapshot.learning_metrics.pending_owner_review_count > 5) {
    snapshot.suggested_focus_areas.push(`Clear learning review backlog: ${snapshot.learning_metrics.pending_owner_review_count} suggestions pending.`);
  }
  if (snapshot.publisher_metrics.support_needed_count > 0) {
    snapshot.suggested_focus_areas.push(`Address publishers: ${snapshot.publisher_metrics.support_needed_count} in support_needed state.`);
  }
  if (snapshot.ingestion_metrics.skipped_duplicate_count > snapshot.ingestion_metrics.imported_count * 2 && snapshot.ingestion_metrics.imported_count > 0) {
    snapshot.suggested_focus_areas.push(`High ingestion duplicate rate in period.`);
  }
  if (snapshot.suggested_focus_areas.length === 0) {
    snapshot.suggested_focus_areas.push(`No immediate focus areas. Operations appear healthy.`);
  }

  return snapshot;
}
