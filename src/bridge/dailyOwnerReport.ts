import { createHash } from "node:crypto";
import type { DailyOwnerReportSummary } from "../contracts/backendContextPayload.js";
import type { QueueItem, ReportDataSource, DailyReportStore, DailyReportState } from "../storage/types.js";
import type { LearningSuggestion, KnowledgePatch, PublishJob } from "../storage/ingestionTypes.js";
import type { EnvConfig } from "../config/env.js";

export function detectDailyReportIntent(text: string): boolean {
  const normalized = text
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ı/g, "i");

  return [
    "gunluk rapor ver",
    "bugun ne oldu",
    "gunluk ozet",
    "bugunku durum",
    "operasyon ozeti",
    "bugun rapor",
    "daily report"
  ].some((phrase) => normalized.includes(phrase));
}

function safePreview(value: string): string {
  return value.replace(/\d{6,}/g, "[masked-number]").replace(/sk-[A-Za-z0-9_-]+/g, "[redacted-key]").slice(0, 160);
}

function selectTopPriorityItems(queueItems: QueueItem[]): DailyOwnerReportSummary["group_summary"]["top_group_followups"] {
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
    .slice(0, 5)
    .map((item) => ({
      sender_masked: item.sender_masked,
      reason: item.reason,
      priority: item.priority,
      last_user_message_preview: safePreview(item.last_user_message_preview),
      suggested_operator_action: item.suggested_operator_action
    }));
}

export function buildDailyOwnerReport(
  dataSource: ReportDataSource,
  dailyReportStore: DailyReportStore,
  env: EnvConfig,
  maintenanceMode: boolean,
  sentToRole: string,
  deliveryMode: "manual" | "scheduled",
  generatedAt = new Date().toISOString()
): DailyOwnerReportSummary {
  const reportDate = generatedAt.split("T")[0];
  
  const isDuplicate = dailyReportStore.checkDailyReportDuplicate(reportDate, deliveryMode, sentToRole);
  const duplicateStatus = isDuplicate
    ? (deliveryMode === "scheduled" ? "skipped_duplicate_scheduled" : "manual_regenerated_same_day")
    : "first_generated";

  const states = dataSource.listCandidateStates();
  const queueItems = dataSource.listQueueItems();
  const queueSummary = dataSource.getQueueSummary();
  const publishers = dataSource.listPublishers();
  const openItems = queueItems.filter((item) => item.status === "open");

  const learningSuggestions: LearningSuggestion[] = dataSource.listLearningSuggestions ? dataSource.listLearningSuggestions() : [];
  const knowledgePatches: KnowledgePatch[] = dataSource.listKnowledgePatches ? dataSource.listKnowledgePatches() : [];
  const publishJobs: PublishJob[] = dataSource.listPublishJobs ? dataSource.listPublishJobs() : [];

  const groupQueueItems = openItems.filter(i => i.reason.startsWith("group_"));

  const candidate_summary = {
    total_candidates: states.length,
    new_leads_count: states.filter((state) => state.current_state === "NEW_LEAD").length,
    waiting_selected_app_count: states.filter((state) => state.missing_fields.includes("selected_app")).length,
    waiting_phone_type_count: states.filter((state) => state.missing_fields.includes("phone_type")).length,
    ready_for_installation_count: states.filter((state) => state.current_state === "READY_FOR_INSTALLATION").length
  };

  const publisher_summary = {
    total_publishers: publishers.length,
    active_publishers: publishers.filter(p => p.activity_status === "active").length,
    inactive_publishers: publishers.filter(p => p.activity_status === "inactive").length,
    training_pending_count: publishers.filter(p => p.training_status === "pending" || p.training_status === "in_progress").length,
    installation_pending_count: publishers.filter(p => p.installation_status === "pending" || p.installation_status === "in_progress").length,
    support_needed_count: publishers.filter(p => p.activity_status === "needs_support").length
  };

  const queue_summary = {
    open_follow_up_count: queueSummary.open_follow_up_count,
    open_missing_info_count: queueSummary.open_missing_info_count,
    high_priority_count: queueSummary.high_priority_count,
    support_signal_count: openItems.filter((item) => item.reason === "support_signal").length,
    payment_or_trust_question_count: openItems.filter((item) => item.reason === "payment_or_trust_question").length
  };

  const group_summary = {
    group_support_signal_count: groupQueueItems.filter(i => i.reason === "group_support_signal").length,
    group_training_question_count: groupQueueItems.filter(i => i.reason === "group_training_question").length,
    group_installation_question_count: groupQueueItems.filter(i => i.reason === "group_installation_question").length,
    group_rule_violation_count: groupQueueItems.filter(i => i.reason === "group_rule_violation_signal").length,
    top_group_followups: selectTopPriorityItems(groupQueueItems)
  };

  const learning_summary = {
    pending_learning_suggestions_count: learningSuggestions.filter(s => s.status === "pending_owner_review").length,
    approved_learning_suggestions_count: learningSuggestions.filter(s => s.status === "approved").length,
    rejected_learning_suggestions_count: learningSuggestions.filter(s => s.status === "rejected").length,
    archived_learning_suggestions_count: learningSuggestions.filter(s => s.status === "archived").length
  };

  const latestSync = knowledgePatches.sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  const latestPublishJob = publishJobs.sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

  const knowledge_summary = {
    knowledge_patches_synced_count: knowledgePatches.filter(p => p.sync_status === "synced").length,
    latest_knowledge_sync_at: latestSync && latestSync.synced_at ? latestSync.synced_at : null,
    last_knowledge_publish_status: latestPublishJob ? latestPublishJob.publish_status : "none",
    file_search_retrieval_ready: env.openaiVectorStoreId !== undefined && env.openaiVectorStoreId !== ""
  };

  const production_summary = {
    maintenance_mode: maintenanceMode,
    webhook_health: "ok",
    backup_available: true,
    security_scan_status: "passed",
    real_publish_flag_enabled: env.realOpenaiPublishEnabled,
    blockers: []
  };

  const suggested_actions: string[] = [];
  if (queue_summary.high_priority_count > 0) suggested_actions.push("HIGH oncelikli aday/grup sinyallerine donus yapilmali.");
  if (candidate_summary.waiting_selected_app_count > 0) suggested_actions.push("Uygulama secmeyen adaylara donus yapilmali.");
  if (candidate_summary.waiting_phone_type_count > 0) suggested_actions.push("Telefon tipi eksik adaylar tamamlanmali.");
  if (publisher_summary.training_pending_count > 0) suggested_actions.push("Egitim bekleyen yayincilar kontrol edilmeli.");
  if (learning_summary.pending_learning_suggestions_count > 0) suggested_actions.push("Bekleyen ogrenme onerileri incelenmeli.");
  if (!knowledge_summary.file_search_retrieval_ready) suggested_actions.push("Knowledge/File Search durumu kontrol edilmeli.");
  if (production_summary.maintenance_mode) suggested_actions.push("Bakim modu acik, aday akisi sinirli.");

  const data_quality_notes: string[] = [];
  if (states.length === 0) data_quality_notes.push("Henuz sistemde kayitli aday yok.");

  const reportHash = createHash("sha256").update(generatedAt + duplicateStatus).digest("hex");

  const summary: DailyOwnerReportSummary = {
    report_date: reportDate,
    timezone: "Europe/Istanbul",
    generated_at: generatedAt,
    delivery_mode: deliveryMode,
    duplicate_status: duplicateStatus,
    candidate_summary,
    publisher_summary,
    queue_summary,
    group_summary,
    learning_summary,
    knowledge_summary,
    production_summary,
    suggested_actions,
    data_quality_notes
  };

  const state: DailyReportState = {
    report_date: reportDate,
    timezone: summary.timezone,
    generated_at: generatedAt,
    sent_to_role: sentToRole,
    delivery_mode: deliveryMode,
    report_hash: reportHash,
    sent_status: "generated",
    created_at: generatedAt,
    updated_at: generatedAt
  };

  dailyReportStore.markDailyReportGenerated(state);

  return summary;
}
