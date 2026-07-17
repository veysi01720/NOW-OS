import type { OwnerReportSummary } from "../contracts/backendContextPayload.js";
import type { QueueItem, ReportDataSource } from "../storage/types.js";
import { logger } from "../observability/logger.js";
import type { LearningSuggestion, KnowledgePatch, PublishJob } from "../storage/ingestionTypes.js";

export function detectOwnerReportIntent(text: string): boolean {
  const normalized = text
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ı/g, "i");

  return [
    "rapor ver",
    "durum nedir",
    "bugun durum ne",
    "aday raporu",
    "takip listesi",
    "eksikler kimde",
    "kimlere donus yapilacak"
  ].some((phrase) => normalized.includes(phrase));
}

function safePreview(value: string): string {
  return value.replace(/\d{6,}/g, "[masked-number]").replace(/sk-[A-Za-z0-9_-]+/g, "[redacted-key]").slice(0, 160);
}

function selectTopPriorityItems(queueItems: QueueItem[]): OwnerReportSummary["top_priority_items"] {
  const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return queueItems
    .filter((item) => item.status === "open")
    .sort((left, right) => {
      const priorityDiff = priorityOrder[left.priority] - priorityOrder[right.priority];
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return Date.parse(right.updated_at) - Date.parse(left.updated_at);
    })
    .slice(0, 10)
    .map((item) => ({
      sender_masked: item.sender_masked,
      reason: item.reason,
      priority: item.priority,
      current_state: item.current_state,
      missing_fields: [...item.missing_fields],
      last_user_message_preview: safePreview(item.last_user_message_preview),
      suggested_operator_action: item.suggested_operator_action,
      last_seen_at: item.last_seen_at
    }));
}

function buildSuggestedOwnerActions(summary: Omit<OwnerReportSummary, "suggested_owner_actions">): string[] {
  const actions: string[] = [];

  if (summary.waiting_selected_app_count > 0) {
    actions.push("Uygulama secmeyen adaylara donus yapilmali.");
  }

  if (summary.waiting_phone_type_count > 0) {
    actions.push("Telefon tipi eksik adaylara donus yapilmali.");
  }

  if (summary.high_priority_count > 0) {
    actions.push("HIGH oncelikli destek sinyali veren adaylara canli destek verilmeli.");
  }

  if (summary.ready_for_installation_count > 0) {
    actions.push("Kurulum asamasindaki adaylar kontrol edilmeli.");
  }

  if (summary.payment_or_trust_question_count > 0) {
    actions.push("Odeme/guven sorusu soran adaylara onayli bilgiyle cevap verilmeli.");
  }

  if (actions.length === 0) {
    actions.push("Su an acil takip aksiyonu gorunmuyor.");
  }

  return actions;
}

function buildDataQualityNotes(totalCandidates: number, queueItems: QueueItem[]): string[] {
  const notes: string[] = [];

  if (totalCandidates === 0) {
    notes.push("No candidate records are available yet.");
  }

  if (queueItems.length === 0) {
    notes.push("Only state data is available; no queue-backed follow-up data is open.");
  }

  return notes;
}

export function buildOwnerReportSummary(dataSource: ReportDataSource, generatedAt = new Date().toISOString()): OwnerReportSummary {
  const states = dataSource.listCandidateStates();
  const queueItems = dataSource.listQueueItems();
  const queueSummary = dataSource.getQueueSummary();
  const publishers = dataSource.listPublishers();
  const openItems = queueItems.filter((item) => item.status === "open");

  const learningSuggestions: LearningSuggestion[] = dataSource.listLearningSuggestions ? dataSource.listLearningSuggestions() : [];
  const knowledgePatches: KnowledgePatch[] = dataSource.listKnowledgePatches ? dataSource.listKnowledgePatches() : [];

  const pendingLearningCount = learningSuggestions.filter(s => s.status === "pending_owner_review").length;
  const approvedLearningCount = learningSuggestions.filter(s => s.status === "approved").length;
  const rejectedLearningCount = learningSuggestions.filter(s => s.status === "rejected").length;
  const archivedLearningCount = learningSuggestions.filter(s => s.status === "archived").length;
  
  const latestLearning = learningSuggestions.sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  const latestLearningDate = latestLearning ? latestLearning.created_at : null;

  const patchesPendingCount = knowledgePatches.filter(p => p.sync_status === "pending_sync").length;
  const patchesSyncedCount = knowledgePatches.filter(p => p.sync_status === "synced").length;
  const patchesFailedCount = knowledgePatches.filter(p => p.sync_status === "failed").length;
  const latestSync = knowledgePatches.sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  const latestSyncDate = latestSync && latestSync.synced_at ? latestSync.synced_at : null;

  const publishJobs: PublishJob[] = dataSource.listPublishJobs ? dataSource.listPublishJobs() : [];
  const latestPublishJob = publishJobs.sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  const lastPublishStatus = latestPublishJob ? latestPublishJob.publish_status : "none";
  const latestPublishDate = latestPublishJob ? latestPublishJob.created_at : null;

  const publisherFollowupReasons = new Set(["training_not_completed", "installation_stuck", "publisher_needs_support", "publisher_inactive", "payment_or_trust_question"]);
  const publisherQueueItems = queueItems.filter(i => publisherFollowupReasons.has(i.reason));

  const groupQueueItems = openItems.filter(i => i.reason.startsWith("group_"));
  const activeGroupsCount = new Set(groupQueueItems.map(i => i.group_id_hash).filter(Boolean)).size;

  const summaryWithoutActions: Omit<OwnerReportSummary, "suggested_owner_actions"> = {
    generated_at: generatedAt,
    total_candidates: states.length,
    active_candidates: states.filter((state) => state.current_state !== "TRAINING_DONE").length,
    new_leads_count: states.filter((state) => state.current_state === "NEW_LEAD").length,
    waiting_selected_app_count: states.filter((state) => state.missing_fields.includes("selected_app")).length,
    waiting_phone_type_count: states.filter((state) => state.missing_fields.includes("phone_type")).length,
    ready_for_installation_count: states.filter((state) => state.current_state === "READY_FOR_INSTALLATION").length,
    open_missing_info_count: queueSummary.open_missing_info_count,
    open_follow_up_count: queueSummary.open_follow_up_count,
    high_priority_count: queueSummary.high_priority_count,
    support_signal_count: openItems.filter((item) => item.reason === "support_signal").length,
    payment_or_trust_question_count: openItems.filter((item) => item.reason === "payment_or_trust_question").length,
    total_publishers: publishers.length,
    active_publishers: publishers.filter(p => p.activity_status === "active").length,
    inactive_publishers: publishers.filter(p => p.activity_status === "inactive").length,
    training_pending_count: publishers.filter(p => p.training_status === "pending" || p.training_status === "in_progress").length,
    installation_pending_count: publishers.filter(p => p.installation_status === "pending" || p.installation_status === "in_progress").length,
    support_needed_count: publishers.filter(p => p.activity_status === "needs_support").length,
    payment_question_count: publishers.filter(p => p.activity_status === "payment_question").length,
    active_groups_count: activeGroupsCount,
    group_support_signal_count: groupQueueItems.filter(i => i.reason === "group_support_signal").length,
    group_training_question_count: groupQueueItems.filter(i => i.reason === "group_training_question").length,
    group_installation_question_count: groupQueueItems.filter(i => i.reason === "group_installation_question").length,
    group_payment_or_trust_question_count: groupQueueItems.filter(i => i.reason === "group_payment_or_trust_question").length,
    group_rule_violation_count: groupQueueItems.filter(i => i.reason === "group_rule_violation_signal").length,
    top_group_followups: groupQueueItems
      .sort((a, b) => {
        const priorityOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      })
      .slice(0, 5)
      .map(i => ({
        sender_masked: i.sender_masked,
        reason: i.reason,
        priority: i.priority,
        current_state: i.current_state,
        missing_fields: i.missing_fields,
        last_user_message_preview: i.last_user_message_preview,
        suggested_operator_action: i.suggested_operator_action,
        last_seen_at: i.last_seen_at
      })),
    ingestion_jobs_count: dataSource.listIngestionJobs ? dataSource.listIngestionJobs().length : 0,
    last_ingestion_status: dataSource.listIngestionJobs && dataSource.listIngestionJobs().length > 0
      ? dataSource.listIngestionJobs().sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())[0].status
      : "none",
    pending_learning_suggestions_count: pendingLearningCount,
    approved_learning_suggestions_count: approvedLearningCount,
    rejected_learning_suggestions_count: rejectedLearningCount,
    archived_learning_suggestions_count: archivedLearningCount,
    latest_learning_review_activity_at: latestLearningDate,
    approved_ready_for_sync_count: approvedLearningCount,
    knowledge_patches_pending_count: patchesPendingCount,
    knowledge_patches_synced_count: patchesSyncedCount,
    knowledge_patches_failed_count: patchesFailedCount,
    latest_knowledge_sync_at: latestSyncDate,
    knowledge_publish_ready: true, // simplified for report
    last_knowledge_publish_status: lastPublishStatus,
    latest_knowledge_publish_at: latestPublishDate,
    knowledge_publish_needed: patchesSyncedCount > 0 && lastPublishStatus !== "completed",
    unpublished_knowledge_changes_count: patchesSyncedCount > 0 ? 1 : 0, // mock count
    support_patterns_found_count: dataSource.listLearningSuggestions
      ? dataSource.listLearningSuggestions().filter(s => s.suggestion_class === "support_signal").length
      : 0,
    payment_trust_patterns_found_count: dataSource.listLearningSuggestions
      ? dataSource.listLearningSuggestions().filter(s => s.suggestion_class === "payment_or_trust_question").length
      : 0,
    complaint_risk_patterns_found_count: dataSource.listLearningSuggestions
      ? dataSource.listLearningSuggestions().filter(s => s.suggestion_class === "complaint_or_risk").length
      : 0,
    top_publisher_followups: selectTopPriorityItems(publisherQueueItems),
    top_priority_items: selectTopPriorityItems(queueItems),
    data_quality_notes: buildDataQualityNotes(states.length, openItems)
  };

  return {
    ...summaryWithoutActions,
    suggested_owner_actions: buildSuggestedOwnerActions(summaryWithoutActions)
  };
}
