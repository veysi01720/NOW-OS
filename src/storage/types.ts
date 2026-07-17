export interface UserIdentityInput {
  normalized_phone_or_jid: string;
}

export interface UserState {
  current_state: string;
  selected_app: string | null;
  phone_type: string | null;
  age: number | null;
  gender: string | null;
  daily_hours: number | null;
  eligibility_status?: "unresolved" | "eligible" | "ineligible" | "policy_missing" | null;
  work_model_disclosed?: boolean;
  model_acceptance?: "pending" | "accepted" | "rejected" | null;
  installation_status: string;
  training_status: string;
  missing_fields: string[];
  expected_next_step: string;
  behavior_conversation_state?: {
    tenantId: string;
    conversationId: string;
    channelType: "private" | "group";
    currentMode: string;
    userStage: string;
    lastResolvedIntent: string | null;
    unresolvedObjections: string[];
    completedTopics: string[];
    pendingTopics: string[];
    lastAssistantAction: string;
    lastUserSentiment: string;
      escalationStatus: string;
      summary: string;
      textOnlyPreference?: boolean;
      preferredWorkMode?: "text_only" | "video_or_voice_allowed";
      videoAllowed?: boolean;
      updatedAt: string;
    };
}

export interface UserStateStore {
  getOrCreateState(userId: string, defaults: UserState, identity?: UserIdentityInput): UserState;
  updateState(userId: string, state: UserState, identity?: UserIdentityInput): void;
}

export interface ProcessedMessageMetadata {
  message_id: string;
  sender_id: string;
  remote_jid: string;
  correlation_id: string;
  status?: string;
}

export interface EventLogInput {
  correlation_id: string;
  sender_masked: string;
  sender_role: string;
  chat_type: string;
  message_id: string;
  current_state: string;
  assistant_status: string;
  parser_result: string;
  sendtext_status: string;
  fallback_used: boolean;
  internal_boss_note_logged: boolean;
  active_bundle_version?: string;
}

export interface EventLogStore {
  recordEvent(event: EventLogInput): void;
}

export type QueueItemStatus = "open" | "resolved" | "dismissed";
export type QueueItemPriority = "HIGH" | "MEDIUM" | "LOW";

export type QueueItemReason =
  | "missing_selected_app"
  | "missing_phone_type"
  | "missing_selected_app_and_phone_type"
  | "ready_for_installation_followup"
  | "installation_not_started"
  | "training_not_started"
  | "support_signal"
  | "payment_or_trust_question"
  | "waiting_candidate_response"
  | "training_not_completed"
  | "installation_stuck"
  | "publisher_needs_support"
  | "publisher_inactive"
  | "group_support_signal"
  | "group_training_question"
  | "group_installation_question"
  | "group_payment_or_trust_question"
  | "group_rule_violation_signal";

export interface QueueItem {
  queue_item_id: string;
  user_id: string;
  sender_masked: string;
  reason: QueueItemReason;
  priority: QueueItemPriority;
  current_state: string;
  missing_fields: string[];
  expected_next_step: string;
  last_seen_at: string;
  last_user_message_preview: string;
  suggested_operator_action: string;
  created_at: string;
  updated_at: string;
  status: QueueItemStatus;
  scope_type?: "private" | "group";
  group_id_hash?: string;
  sender_id_hash?: string;
  safe_ref?: string;
}

export interface QueueItemUpsertInput {
  user_id: string;
  sender_masked: string;
  reason: QueueItemReason;
  priority: QueueItemPriority;
  current_state: string;
  missing_fields: string[];
  expected_next_step: string;
  last_seen_at: string;
  last_user_message_preview: string;
  suggested_operator_action: string;
  scope_type?: "private" | "group";
  group_id_hash?: string;
  sender_id_hash?: string;
  safe_ref?: string;
}

export interface QueueSummary {
  open_missing_info_count: number;
  open_follow_up_count: number;
  high_priority_count: number;
  users_waiting_selected_app: number;
  users_waiting_phone_type: number;
  users_ready_for_installation: number;
  open_items_by_priority: Record<QueueItemPriority, number>;
  open_items_by_reason: Partial<Record<QueueItemReason, number>>;
}

export interface QueueStore {
  upsertOpenItem(input: QueueItemUpsertInput): QueueItem;
  resolveOpenItems(userId: string, reasons: QueueItemReason[], now?: string): QueueItem[];
  resolveOpenItemBySafeRef(safeRef: string, now?: string): QueueItem | null;
  listItems(): QueueItem[];
  getOpenItemsForUser(userId: string): QueueItem[];
  getSummary(): QueueSummary;
}

export type PublisherActivityStatus =
  | "new"
  | "onboarding"
  | "installation"
  | "training"
  | "ready"
  | "active"
  | "inactive"
  | "needs_support"
  | "payment_question";

export interface Publisher {
  publisher_id: string;
  user_id: string;
  display_name: string;
  selected_app: string;
  phone_type: string;
  onboarding_status: string;
  installation_status: string;
  training_status: string;
  activity_status: PublisherActivityStatus;
  last_seen_at: string;
  last_operator_action: string;
  notes: string;
  source_platform: string;
  created_at: string;
  updated_at: string;
  safe_ref?: string;
}

export interface PublisherUpdateResult {
  found: boolean;
  already_current: boolean;
  previous_status?: string;
  new_status?: string;
  publisher_safe_ref?: string;
}

export interface PublisherStore {
  upsertPublisher(input: Partial<Publisher> & { user_id: string }): Publisher;
  listPublishers(): Publisher[];
  getPublisher(userId: string): Publisher | undefined;
  updatePublisherStatusBySafeRef(safeRef: string, status: PublisherActivityStatus): PublisherUpdateResult;
}

export interface CandidateReportState {
  user_id: string;
  sender_masked: string;
  current_state: string;
  selected_app: string | null;
  phone_type: string | null;
  missing_fields: string[];
  expected_next_step: string;
  last_seen_at: string;
}

import type { IngestionJob, LearningSuggestion, KnowledgePatch, PublishJob } from "./ingestionTypes.js";

export interface ReportDataSource {
  listCandidateStates(): CandidateReportState[];
  listQueueItems(): QueueItem[];
  getQueueSummary(): QueueSummary;
  listPublishers(): Publisher[];
  listIngestionJobs?(): IngestionJob[];
  listLearningSuggestions?(): LearningSuggestion[];
  listKnowledgePatches?(): KnowledgePatch[];
  listPublishJobs?(): PublishJob[];
}

export interface DailyReportState {
  report_date: string;
  timezone: string;
  generated_at: string;
  sent_to_role: string;
  delivery_mode: "manual" | "scheduled";
  report_hash: string;
  sent_status: "generated" | "sent" | "skipped_duplicate" | "failed";
  created_at: string;
  updated_at: string;
}

export interface DailyReportStore {
  markDailyReportGenerated(state: DailyReportState): void;
  checkDailyReportDuplicate(reportDate: string, deliveryMode: string, sentToRole: string): boolean;
}

export function defaultUserState(): UserState {
  return {
    current_state: "NEW_LEAD",
    selected_app: null,
    phone_type: null,
    age: null,
    gender: null,
    daily_hours: null,
    eligibility_status: "unresolved",
    work_model_disclosed: false,
    model_acceptance: null,
    installation_status: "not_started",
    training_status: "not_started",
    missing_fields: ["age", "gender", "daily_hours", "selected_app", "phone_type"],
    expected_next_step: "ask_intake_info"
  };
}
