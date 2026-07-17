import { createHash } from "node:crypto";
import type { BackendContextPayloadV1 } from "../contracts/backendContextPayload.js";
import { getConversationKey } from "./buildBackendContext.js";
import type { Logger } from "../observability/logger.js";
import type {
  QueueItem,
  QueueItemPriority,
  QueueItemReason,
  QueueItemUpsertInput,
  QueueStore,
  PublisherStore
} from "../storage/types.js";
import type { NormalizedIncomingMessage } from "./normalizeEvolutionMessage.js";

export interface QueueEvaluationResult {
  evaluated: boolean;
  skipped_reason?: "non_candidate_role" | "non_private_chat" | "missing_queue_store";
  created_or_updated: QueueItem[];
  resolved: QueueItem[];
}

const MISSING_INFO_REASONS: QueueItemReason[] = [
  "missing_selected_app",
  "missing_phone_type",
  "missing_selected_app_and_phone_type"
];

function maskPhone(phoneNumber: string): string {
  return phoneNumber.length <= 3 ? "***" : `${phoneNumber.slice(0, 3)}***`;
}

export function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i") // specifically handles dotless i fallback if missed
    .replace(/[^a-z0-9\s]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function preview(value: string): string {
  return value
    .replace(/\d{6,}/g, "[masked-number]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted-key]")
    .slice(0, 160);
}

function queueUserId(value: string): string {
  return `user_${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function priorityForReason(reason: QueueItemReason): QueueItemPriority {
  if (
    reason === "support_signal" ||
    reason === "payment_or_trust_question" ||
    reason === "ready_for_installation_followup" ||
    reason === "publisher_needs_support" ||
    reason === "installation_stuck" ||
    reason === "group_support_signal" ||
    reason === "group_payment_or_trust_question" ||
    reason === "group_rule_violation_signal"
  ) {
    return "HIGH";
  }

  if (
    reason === "missing_selected_app" ||
    reason === "missing_phone_type" ||
    reason === "missing_selected_app_and_phone_type" ||
    reason === "group_training_question" ||
    reason === "group_installation_question"
  ) {
    return "MEDIUM";
  }

  return "LOW";
}

function suggestedAction(reason: QueueItemReason): string {
  switch (reason) {
    case "missing_selected_app":
      return "Ask candidate which approved app they were directed to.";
    case "missing_phone_type":
      return "Ask candidate whether they use Android or iOS.";
    case "missing_selected_app_and_phone_type":
      return "Ask candidate for approved app and phone type.";
    case "ready_for_installation_followup":
      return "Check installation readiness and guide the candidate with approved steps.";
    case "installation_not_started":
      return "Follow up on installation start.";
    case "training_not_started":
      return "Follow up on training start.";
    case "support_signal":
      return "Review candidate support need and help with the blocked step.";
    case "payment_or_trust_question":
      return "Review trust/payment question and answer only with approved guidance.";
    case "waiting_candidate_response":
      return "Follow up with candidate if they remain inactive.";
    case "training_not_completed":
      return "Help publisher complete their training.";
    case "installation_stuck":
      return "Assist publisher with stuck installation.";
    case "publisher_needs_support":
      return "Provide high-priority support to active publisher.";
    case "publisher_inactive":
      return "Reach out to inactive publisher to encourage activity.";
    case "group_support_signal":
      return "Check group chat for support signal.";
    case "group_training_question":
      return "Check group chat for training question.";
    case "group_installation_question":
      return "Check group chat for installation question.";
    case "group_payment_or_trust_question":
      return "Check group chat for payment/trust question.";
    case "group_rule_violation_signal":
      return "Check group chat for rule violation.";
  }
}

function hasSupportSignal(text: string): boolean {
  const norm = normalizeText(text);
  return norm.includes("yapamadim") || norm.includes("olmuyor") || norm.includes("takildim") || norm.includes("anlamadim") || norm.includes("hata veriyor") || /\b(yardim|hata verdi)\b/u.test(norm);
}

function hasPaymentOrTrustQuestion(text: string): boolean {
  const norm = normalizeText(text);
  return norm.includes("odeme") || norm.includes("para") || norm.includes("guvenilir mi") || norm.includes("ne zaman yatar") || /\b(is nedir|kazanc|maas|garanti)\b/u.test(norm);
}

function hasTrainingQuestion(text: string): boolean {
  const norm = normalizeText(text);
  return norm.includes("egitim") || norm.includes("nasil calisacagim") || norm.includes("nasil yapacagim");
}

function hasInstallationQuestion(text: string): boolean {
  const norm = normalizeText(text);
  return norm.includes("kurulum") || norm.includes("yukleyemedim") || norm.includes("giris yapamiyorum");
}

function hasRuleViolationSignal(text: string): boolean {
  const norm = normalizeText(text);
  return norm.includes("kavga") || norm.includes("kufur") || norm.includes("spam") || norm.includes("uygunsuz");
}

function makeInput(
  reason: QueueItemReason,
  message: NormalizedIncomingMessage,
  context: BackendContextPayloadV1
): QueueItemUpsertInput {
  const isGroup = context.chat_type === "group";
  const scope_type = isGroup ? "group" : "private";
  const group_id_hash = isGroup ? createHash("sha256").update(message.remote_jid).digest("hex").slice(0, 16) : undefined;
  const sender_id_hash = isGroup ? createHash("sha256").update(message.sender_id).digest("hex").slice(0, 16) : undefined;

  return {
    user_id: queueUserId(isGroup ? message.remote_jid + message.sender_id : context.sender.phone_number),
    sender_masked: maskPhone(context.sender.phone_number),
    reason,
    priority: priorityForReason(reason),
    current_state: context.state.current_state,
    missing_fields: [...context.state.missing_fields],
    expected_next_step: context.state.expected_next_step,
    last_seen_at: context.user_message.received_at,
    last_user_message_preview: preview(message.text),
    suggested_operator_action: suggestedAction(reason),
    scope_type,
    group_id_hash,
    sender_id_hash
  };
}

function desiredReasons(message: NormalizedIncomingMessage, context: BackendContextPayloadV1): QueueItemReason[] {
  const reasons = new Set<QueueItemReason>();
  const missing = new Set(context.state.missing_fields);

  if (missing.has("selected_app")) {
    reasons.add("missing_selected_app");
  }

  if (missing.has("phone_type")) {
    reasons.add("missing_phone_type");
  }

  if (missing.has("selected_app") && missing.has("phone_type")) {
    reasons.add("missing_selected_app_and_phone_type");
  }

  if (context.state.current_state === "READY_FOR_INSTALLATION") {
    reasons.add("ready_for_installation_followup");
    if (context.state.installation_status === "not_started") {
      reasons.add("installation_not_started");
    }
  }

  if (
    (context.state.current_state === "INSTALLATION_DONE" || context.state.current_state === "TRAINING_READY") &&
    context.state.training_status === "not_started"
  ) {
    reasons.add("training_not_started");
  }

  if (hasSupportSignal(message.text)) {
    reasons.add("support_signal");
  }

  if (hasPaymentOrTrustQuestion(message.text)) {
    reasons.add("payment_or_trust_question");
  }

  return [...reasons];
}

function publisherDesiredReasons(message: NormalizedIncomingMessage, context: BackendContextPayloadV1, publisherStore: PublisherStore | undefined): QueueItemReason[] {
  const reasons = new Set<QueueItemReason>();
  
  if (!publisherStore) return [];
  
  const publisher = publisherStore.getPublisher(getConversationKey(message));
  if (!publisher) return [];

  if (publisher.training_status === "pending" || publisher.training_status === "in_progress") {
    reasons.add("training_not_completed");
  }

  if (publisher.installation_status === "pending" || publisher.installation_status === "in_progress") {
    reasons.add("installation_stuck");
  }

  if (publisher.activity_status === "needs_support") {
    reasons.add("publisher_needs_support");
  }

  if (publisher.activity_status === "inactive") {
    reasons.add("publisher_inactive");
  }

  if (publisher.activity_status === "payment_question" || hasPaymentOrTrustQuestion(message.text)) {
    reasons.add("payment_or_trust_question");
  }

  return [...reasons];
}

function obsoleteMissingReasons(context: BackendContextPayloadV1): QueueItemReason[] {
  const missing = new Set(context.state.missing_fields);
  const reasons: QueueItemReason[] = [];

  if (!missing.has("selected_app")) {
    reasons.push("missing_selected_app");
  }

  if (!missing.has("phone_type")) {
    reasons.push("missing_phone_type");
  }

  if (!(missing.has("selected_app") && missing.has("phone_type"))) {
    reasons.push("missing_selected_app_and_phone_type");
  }

  return reasons;
}

export function evaluateFollowUpQueue(
  message: NormalizedIncomingMessage,
  context: BackendContextPayloadV1,
  queueStore: QueueStore | undefined,
  publisherStore: PublisherStore | undefined,
  logger: Logger
): QueueEvaluationResult {
  if (context.chat_type === "group") {
    if (queueStore === undefined) {
      return { evaluated: false, skipped_reason: "missing_queue_store", created_or_updated: [], resolved: [] };
    }
    
    let groupReason: QueueItemReason | undefined;
    if (hasSupportSignal(message.text)) groupReason = "group_support_signal";
    else if (hasPaymentOrTrustQuestion(message.text)) groupReason = "group_payment_or_trust_question";
    else if (hasRuleViolationSignal(message.text)) groupReason = "group_rule_violation_signal";
    else if (hasInstallationQuestion(message.text)) groupReason = "group_installation_question";
    else if (hasTrainingQuestion(message.text)) groupReason = "group_training_question";

    if (groupReason) {
      const item = queueStore.upsertOpenItem(makeInput(groupReason, message, context));
      logger.info({
        event_type: "GROUP_QUEUE_ITEM_CREATED",
        correlation_id: context.correlation_id,
        reason: groupReason,
        priority: item.priority
      });
      return { evaluated: true, created_or_updated: [item], resolved: [] };
    }

    return { evaluated: true, created_or_updated: [], resolved: [] };
  }

  if (context.sender_role !== "candidate") {
    return { evaluated: false, skipped_reason: "non_candidate_role", created_or_updated: [], resolved: [] };
  }

  if (queueStore === undefined) {
    return { evaluated: false, skipped_reason: "missing_queue_store", created_or_updated: [], resolved: [] };
  }

  const userId = queueUserId(context.sender.phone_number);
  logger.info({
    event_type: "QUEUE_EVALUATED",
    correlation_id: context.correlation_id,
    sender_masked: maskPhone(context.sender.phone_number),
    current_state: context.state.current_state,
    missing_fields: context.state.missing_fields
  });

  const resolved = queueStore.resolveOpenItems(userId, obsoleteMissingReasons(context));
  for (const item of resolved) {
    logger.info({
      event_type: "QUEUE_ITEM_RESOLVED",
      correlation_id: context.correlation_id,
      queue_item_id: item.queue_item_id,
      sender_masked: item.sender_masked,
      reason: item.reason,
      priority: item.priority,
      status: item.status,
      current_state: context.state.current_state
    });
  }

  const existingOpen = queueStore.getOpenItemsForUser(userId);
  const reasonsToCreate = [...desiredReasons(message, context), ...publisherDesiredReasons(message, context, publisherStore)];
  const createdOrUpdated = reasonsToCreate.map((reason) => {
    const hadOpen = existingOpen.some((item) => item.reason === reason);
    const item = queueStore.upsertOpenItem(makeInput(reason, message, context));
    logger.info({
      event_type: hadOpen ? "QUEUE_ITEM_UPDATED" : "QUEUE_ITEM_CREATED",
      correlation_id: context.correlation_id,
      queue_item_id: item.queue_item_id,
      sender_masked: item.sender_masked,
      reason: item.reason,
      priority: item.priority,
      status: item.status,
      current_state: item.current_state
    });
    if (hadOpen) {
      logger.info({
        event_type: "QUEUE_DEDUPE_HIT",
        correlation_id: context.correlation_id,
        queue_item_id: item.queue_item_id,
        sender_masked: item.sender_masked,
        reason: item.reason,
        priority: item.priority,
        status: item.status,
        current_state: item.current_state
      });
    }
    return item;
  });

  logger.info({
    event_type: "QUEUE_AGGREGATES_UPDATED",
    correlation_id: context.correlation_id,
    summary: queueStore.getSummary()
  });

  return {
    evaluated: true,
    created_or_updated: createdOrUpdated,
    resolved
  };
}
