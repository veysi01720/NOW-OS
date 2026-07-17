import type { LearningReviewContext } from "../contracts/backendContextPayload.js";
import type { PersistentIngestionStore } from "../storage/ingestionStore.js";
import type { LearningSuggestionStatus } from "../storage/ingestionTypes.js";

export type LearningReviewAction = "view_list" | "view_detail" | "view_summary" | "approve" | "reject" | "archive";

export interface LearningReviewIntent {
  action: LearningReviewAction;
  targetRef?: string;
}

export function detectLearningReviewIntent(text: string): LearningReviewIntent | null {
  const lower = text.toLowerCase().trim();

  // Action intents with LRN-X
  const lrnMatch = lower.match(/(?:lrn|öneri)\s*-?\s*(\d+)\s*(detay|onayla|reddet|arşivle)/i);
  if (lrnMatch) {
    const num = lrnMatch[1];
    const actionStr = lrnMatch[2];
    const targetRef = `LRN-${num}`;
    let action: LearningReviewAction = "view_detail";
    if (actionStr === "onayla") action = "approve";
    if (actionStr === "reddet") action = "reject";
    if (actionStr === "arşivle") action = "archive";
    return { action, targetRef };
  }

  // General listing and summary intents
  if (lower.includes("öğrenme kuyruğu") || lower.includes("öğrenme öneri") || lower.includes("bekleyen öneri")) {
    return { action: "view_list" };
  }
  if (lower.includes("öğrenme özeti")) {
    return { action: "view_summary" };
  }

  return null;
}

export function buildLearningReviewContext(
  intent: LearningReviewIntent,
  store: PersistentIngestionStore,
  maskedUserRole: string
): LearningReviewContext {
  const suggestions = store.listLearningSuggestions();
  
  const pending = suggestions.filter((s) => s.status === "pending_owner_review");
  const approved = suggestions.filter((s) => s.status === "approved");
  const rejected = suggestions.filter((s) => s.status === "rejected");
  const archived = suggestions.filter((s) => s.status === "archived");

  // Stable sort by created_at ascending
  pending.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const context: LearningReviewContext = {
    pending_count: pending.length,
    approved_count: approved.length,
    rejected_count: rejected.length,
    archived_count: archived.length,
    latest_pending_suggestions: pending.slice(0, 10).map((s) => ({
      suggestion_ref: s.short_ref!,
      platform: s.platform,
      class: s.suggestion_class,
      evidence_preview_sanitized: s.evidence_preview_sanitized,
      proposed_knowledge_type: s.proposed_knowledge_type,
      proposed_text_sanitized: s.proposed_text,
      confidence: s.confidence,
      created_at: s.created_at
    })),
    allowed_actions: ["view_list", "view_detail", "approve", "reject", "archive"],
    data_quality_notes: []
  };

  if (intent.targetRef) {
    const target = store.getLearningSuggestionByShortRef(intent.targetRef);
    if (target) {
      context.selected_suggestion_detail = {
        suggestion_ref: target.short_ref!,
        platform: target.platform,
        class: target.suggestion_class,
        evidence_preview_sanitized: target.evidence_preview_sanitized,
        proposed_knowledge_type: target.proposed_knowledge_type,
        proposed_text_sanitized: target.proposed_text,
        confidence: target.confidence,
        status: target.status,
        created_at: target.created_at
      };

      if (intent.action === "approve" || intent.action === "reject" || intent.action === "archive") {
        let success = false;
        let message = "";
        const previousStatus = target.status;
        let newStatus: LearningSuggestionStatus = target.status;

        if (previousStatus !== "pending_owner_review") {
          message = `Bu öneri zaten '${previousStatus}' statüsünde.`;
        } else {
          if (intent.action === "approve") newStatus = "approved";
          else if (intent.action === "reject") newStatus = "rejected";
          else if (intent.action === "archive") newStatus = "archived";

          const updated = store.updateLearningSuggestionStatus(target.suggestion_id, newStatus, maskedUserRole);
          if (updated) {
            success = true;
            message = intent.action === "approve" 
              ? "Bu öneri onaylandı ve onaylı öğrenme havuzuna alındı." 
              : `Bu öneri '${newStatus}' statüsüne geçirildi.`;
          } else {
            message = "Öneri güncellenemedi.";
          }
        }

        context.action_result = {
          action: intent.action,
          suggestion_ref: intent.targetRef,
          previous_status: previousStatus,
          new_status: newStatus,
          success,
          message
        };

        // If the action succeeded, update detail in the context
        if (success) {
          context.selected_suggestion_detail!.status = newStatus;
          // Refresh counts locally in context for immediate accuracy
          if (previousStatus === "pending_owner_review") {
            context.pending_count--;
            if (newStatus === "approved") context.approved_count++;
            if (newStatus === "rejected") context.rejected_count++;
            if (newStatus === "archived") context.archived_count++;
            // Remove from latest_pending_suggestions if it was there
            context.latest_pending_suggestions = context.latest_pending_suggestions.filter(
              s => s.suggestion_ref !== intent.targetRef
            );
          }
        }
      }
    } else {
      context.data_quality_notes.push(`Belirtilen referans (${intent.targetRef}) bulunamadı.`);
    }
  }

  return context;
}
