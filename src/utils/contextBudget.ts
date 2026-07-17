import type { BackendContextPayloadV1 } from "../contracts/backendContextPayload.js";

export const BUDGET_LIMITS = {
  NORMAL_USER_TARGET: 6000,
  OWNER_MANAGER_TARGET: 12000,
  DAILY_REPORT_TARGET: 16000,
  HARD_CAP: 22000,
  SAFETY_MULTIPLIER: 1.15
};

export type ContextProfile = "normal_user" | "owner_manager" | "daily_report" | "emergency_compact";

export interface BudgetMetrics {
  context_profile: ContextProfile;
  estimated_tokens_before: number;
  estimated_tokens_after: number;
  compacted: boolean;
  sections_dropped: string[];
  array_caps_applied: string[];
  hard_cap_triggered: boolean;
}

export function estimateTokens(payload: unknown): number {
  if (payload === undefined || payload === null) return 0;
  const str = JSON.stringify(payload);
  const rawEstimate = Math.ceil(str.length / 4);
  return Math.ceil(rawEstimate * BUDGET_LIMITS.SAFETY_MULTIPLIER);
}

function capArray<T>(arr: T[] | undefined, max: number): T[] | undefined {
  if (!Array.isArray(arr)) return arr;
  if (arr.length <= max) return arr;
  return arr.slice(0, max);
}

export function sanitizeAndBudgetContext(
  rawContext: BackendContextPayloadV1,
  profile: ContextProfile,
  isRetry: boolean = false
): { context: BackendContextPayloadV1; metrics: BudgetMetrics } {
  let context = JSON.parse(JSON.stringify(rawContext)) as BackendContextPayloadV1;
  const initialTokens = estimateTokens(context);
  
  const metrics: BudgetMetrics = {
    context_profile: profile,
    estimated_tokens_before: initialTokens,
    estimated_tokens_after: initialTokens,
    compacted: false,
    sections_dropped: [],
    array_caps_applied: [],
    hard_cap_triggered: false
  };

  let targetTokens = BUDGET_LIMITS.NORMAL_USER_TARGET;
  if (profile === "owner_manager") targetTokens = BUDGET_LIMITS.OWNER_MANAGER_TARGET;
  if (profile === "daily_report") targetTokens = BUDGET_LIMITS.DAILY_REPORT_TARGET;
  if (profile === "emergency_compact") targetTokens = 3000;

  if (isRetry) {
    targetTokens = Math.floor(targetTokens * 0.7); // Apply a 30% reduction on retry
    metrics.array_caps_applied.push("retry_penalty");
  }

  // 1. Initial Profile-based pruning
  if (profile === "normal_user" || profile === "emergency_compact") {
    if (context.report_summary) { delete context.report_summary; metrics.sections_dropped.push("report_summary"); }
    if (context.daily_report) { delete context.daily_report; metrics.sections_dropped.push("daily_report"); }
    if (context.learning_review) { delete context.learning_review; metrics.sections_dropped.push("learning_review"); }
    if (context.knowledge_publish) { delete context.knowledge_publish; metrics.sections_dropped.push("knowledge_publish"); }
    if (context.knowledge_sync) { delete context.knowledge_sync; metrics.sections_dropped.push("knowledge_sync"); }
    if (context.group) { delete context.group; metrics.sections_dropped.push("group"); }
  }

  if (profile === "owner_manager" || profile === "daily_report") {
    // Cap arrays inside report_summary
    if (context.report_summary) {
      if (context.report_summary.top_group_followups?.length > 10) {
        context.report_summary.top_group_followups = capArray(context.report_summary.top_group_followups, 10)!;
        metrics.array_caps_applied.push("top_group_followups");
      }
      if (context.report_summary.top_publisher_followups?.length > 10) {
        context.report_summary.top_publisher_followups = capArray(context.report_summary.top_publisher_followups, 10)!;
        metrics.array_caps_applied.push("top_publisher_followups");
      }
      if (context.report_summary.top_priority_items?.length > 10) {
        context.report_summary.top_priority_items = capArray(context.report_summary.top_priority_items, 10)!;
        metrics.array_caps_applied.push("top_priority_items");
      }
    }
    
    // Cap arrays in daily_report
    if (context.daily_report && context.daily_report.group_summary?.top_group_followups?.length > 10) {
      context.daily_report.group_summary.top_group_followups = capArray(context.daily_report.group_summary.top_group_followups, 10)!;
      metrics.array_caps_applied.push("daily_group_followups");
    }

    if (context.learning_review && context.learning_review.latest_pending_suggestions && context.learning_review.latest_pending_suggestions.length > 5) {
      context.learning_review.latest_pending_suggestions = capArray(context.learning_review.latest_pending_suggestions, 5)!;
      metrics.array_caps_applied.push("latest_pending_suggestions");
    }
  }

  let currentTokens = estimateTokens(context);

  // 2. Iterative Compaction if still over Target
  if (currentTokens > targetTokens) {
    metrics.compacted = true;
    // Step A: Drop learning review
    if (context.learning_review) {
      delete context.learning_review;
      metrics.sections_dropped.push("learning_review_compaction");
      currentTokens = estimateTokens(context);
    }
  }

  if (currentTokens > targetTokens) {
    // Step B: Drop knowledge items
    if (context.knowledge_publish) {
      delete context.knowledge_publish;
      metrics.sections_dropped.push("knowledge_publish_compaction");
    }
    if (context.knowledge_sync) {
      delete context.knowledge_sync;
      metrics.sections_dropped.push("knowledge_sync_compaction");
    }
    currentTokens = estimateTokens(context);
  }

  if (currentTokens > targetTokens && (profile === "owner_manager" || profile === "daily_report")) {
     // Step C: Aggressively cap to 3 items
     if (context.report_summary?.top_priority_items) {
       context.report_summary.top_priority_items = capArray(context.report_summary.top_priority_items, 3)!;
       metrics.array_caps_applied.push("top_priority_items_aggro");
     }
     if (context.report_summary?.top_group_followups) {
      context.report_summary.top_group_followups = capArray(context.report_summary.top_group_followups, 3)!;
      metrics.array_caps_applied.push("top_group_followups_aggro");
    }
    if (context.report_summary?.top_publisher_followups) {
      context.report_summary.top_publisher_followups = capArray(context.report_summary.top_publisher_followups, 3)!;
      metrics.array_caps_applied.push("top_publisher_followups_aggro");
    }
    currentTokens = estimateTokens(context);
  }

  // 3. Hard Cap Emergency Fail-Closed Check
  if (currentTokens > BUDGET_LIMITS.HARD_CAP) {
    metrics.hard_cap_triggered = true;
    metrics.compacted = true;
    
    // Build an extreme emergency context
    context = {
      backend_context_version: context.backend_context_version,
      correlation_id: context.correlation_id,
      sender_role: context.sender_role,
      chat_type: context.chat_type,
      sender: context.sender, // Contains safe details
      chat: context.chat,
      allowed_apps: [],
      state: context.state, // Minimal needed state
      memory: {
        conversation_summary: context.memory?.summary ?? "Emergency mode active.",
        last_5_user_messages: [],
        last_5_bot_replies: [],
        last_10_messages: []
      },
      versions: context.versions,
      user_message: context.user_message
    } as any;
    
    metrics.sections_dropped.push("emergency_wipe");
    currentTokens = estimateTokens(context);
  }

  metrics.estimated_tokens_after = currentTokens;
  return { context, metrics };
}
