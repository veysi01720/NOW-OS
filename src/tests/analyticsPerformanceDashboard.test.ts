import { buildAnalyticsSnapshot } from "../analytics/analyticsService.js";

describe("Analytics & Performance Dashboard (SPEC-027)", () => {
  it("computes deterministic health score and sanitizes output correctly", () => {
    const deps: any = {
      reportDataSource: {
        listCandidateStates: () => [
          { current_state: 'pending_contact' },
          { current_state: 'blocked' }
        ],
        listPublishers: () => [
          { status: 'active' },
          { status: 'support_needed' }
        ],
        listQueueItems: () => [
          { current_state: 'open', reason: 'training' },
          { current_state: 'open', reason: 'support' },
          { current_state: 'resolved', reason: 'training' }
        ],
        listLearningSuggestions: () => [
          { status: 'pending_owner_review' },
          { status: 'approved' }
        ],
        listIngestionJobs: () => [
          { status: 'failed', started_at: new Date().toISOString() },
          { status: 'completed', started_at: new Date().toISOString(), total_duplicates_skipped: 10, total_messages_seen: 20, total_messages_ingested: 10 }
        ]
      },
      scheduledReportRunStore: {
        getRuns: () => [
          { status: 'failed', target_mode: 'whatsapp', generated_at: new Date().toISOString() }
        ]
      },
      actionAuditStore: {
        getRecentLogs: () => [
          { action_type: '/dashboard/actions/queue/resolve', result_status: 'success', actor_role: 'manager', created_at: new Date().toISOString() },
          { action_type: '/dashboard/actions/learning/review', result_status: 'failure', actor_role: 'manager', created_at: new Date().toISOString() }
        ]
      }
    };

    const snapshot = buildAnalyticsSnapshot({ period: 'today', deps });

    // Candidate Metrics
    expect(snapshot.candidate_metrics.total_candidates).toBe(2);
    expect(snapshot.candidate_metrics.active_candidates).toBe(1);
    
    // Publisher Metrics
    expect(snapshot.publisher_metrics.support_needed_count).toBe(1);

    // Health Score logic check
    // 1 support needed = -10
    // 1 failed ingestion = -10
    // 1 failed report = -20
    // overdue followups = 0
    expect(snapshot.health_score.score).toBeLessThan(100);
    expect(snapshot.health_score.status).toMatch(/good|watch|critical/);

    // Sanity check
    expect(snapshot.dashboard_action_metrics.blocked_action_count).toBe(1);
  });

  it("handles empty data without hallucinating", () => {
    const deps: any = {
      reportDataSource: {
        listCandidateStates: () => [],
        listPublishers: () => [],
        listQueueItems: () => [],
        listLearningSuggestions: () => [],
        listIngestionJobs: () => []
      },
      scheduledReportRunStore: { getRuns: () => [] },
      actionAuditStore: { getRecentLogs: () => [] }
    };
    const snapshot = buildAnalyticsSnapshot({ period: '7d', deps });
    expect(snapshot.candidate_metrics.total_candidates).toBe(0);
    expect(snapshot.health_score.score).toBe(100);
    expect(snapshot.health_score.status).toBe('good');
    expect(snapshot.suggested_focus_areas).toContain('No immediate focus areas. Operations appear healthy.');
  });

  it("safely falls back on invalid periods", () => {
    const deps: any = {};
    const snapshot = buildAnalyticsSnapshot({ period: 'invalid_xyz', deps });
    expect(snapshot.period_label).toBe('7d');
    expect(snapshot.data_quality_notes.some(n => n.includes("Invalid period"))).toBe(true);
  });
});
