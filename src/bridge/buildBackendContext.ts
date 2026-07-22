import type { EnvConfig } from "../config/env.js";
import type { BackendContextPayloadV1 } from "../contracts/backendContextPayload.js";
import type { MemoryStore } from "../storage/memoryStore.js";
import { defaultUserState, type UserState, type UserStateStore } from "../storage/types.js";
import type { ReportDataSource } from "../storage/types.js";
import type { PersistentIngestionStore } from "../storage/ingestionStore.js";
import type { NormalizedIncomingMessage } from "./normalizeEvolutionMessage.js";
import { detectOwnerReportIntent, buildOwnerReportSummary } from "./ownerReport.js";
import { detectLearningReviewIntent, buildLearningReviewContext } from "./learningReview.js";
import { detectKnowledgeSyncIntent, buildKnowledgeSyncContext } from "./knowledgeSync.js";
import { detectKnowledgePublishIntent, buildKnowledgePublishContext } from "./knowledgePublish.js";
import { detectDailyReportIntent, buildDailyOwnerReport } from "./dailyOwnerReport.js";
import type { DailyReportStore } from "../storage/types.js";
import type { MaintenanceStore } from "../store/maintenanceStore.js";
import { resolveAuthorityContext, type AuthorityContext } from "./authorityContext.js";
import { loadStructuredAppFacts } from "./structuredAppFacts.js";

export function getConversationKey(message: NormalizedIncomingMessage): string {
  return message.chat_type === "private" ? message.phone_number : message.remote_jid;
}

export function getTenantConversationKey(tenantId: string, message: NormalizedIncomingMessage): string {
  return `${tenantId}:${message.chat_type}:${getConversationKey(message)}`;
}

function nonCandidateState(): UserState {
  return {
    current_state: "NON_CANDIDATE",
    selected_app: null,
    phone_type: null,
    age: null,
    gender: null,
    daily_hours: null,
    eligibility_status: null,
    work_model_disclosed: false,
    model_acceptance: null,
    installation_status: "not_applicable",
    training_status: "not_applicable",
    missing_fields: [],
    expected_next_step: "none"
  };
}

export function buildBackendContext(
  message: NormalizedIncomingMessage,
  env: EnvConfig,
  memoryStore: MemoryStore,
  userStateStore?: UserStateStore,
  reportDataSource?: ReportDataSource,
  ingestionStore?: PersistentIngestionStore,
  dailyReportStore?: DailyReportStore,
  maintenanceStore?: MaintenanceStore,
  authorityContext?: AuthorityContext,
): BackendContextPayloadV1 {
  const conversationKey = getConversationKey(message);
  const senderRole = (authorityContext ?? resolveAuthorityContext(message, env)).sender_role;
  const shouldUseCandidateState = senderRole === "candidate" && message.chat_type === "private";
  const state = shouldUseCandidateState
    ? userStateStore?.getOrCreateState(conversationKey, defaultUserState(), {
        normalized_phone_or_jid: conversationKey
      }) ?? defaultUserState()
    : nonCandidateState();

  const context: BackendContextPayloadV1 = {
    backend_context_version: "1.0",
    correlation_id: message.correlation_id,
    sender_role: senderRole,
    chat_type: message.chat_type,
    sender: {
      sender_id: message.sender_id,
      ...(message.push_name ? { display_name: message.push_name } : {}),
      phone_number: message.phone_number
    },
    chat: {
      remote_jid: message.remote_jid,
      message_id: message.message_id,
      message_type: message.message_type,
      is_from_me: message.is_from_me,
      is_group: message.is_group
    },
    allowed_apps: env.approvedApps,
    state,
    memory: memoryStore.get(conversationKey),
    versions: env.versions,
    structured_facts: (() => {
      const source = loadStructuredAppFacts();
      return {
        app_facts_source_status: source.source_status,
        app_facts_source_hash: source.source_hash,
        app_facts: source.app_facts,
        errors: source.errors,
      };
    })(),
    ...(message.chat_type === "group" ? {
      group: {
        group_safe_mode: true
      }
    } : {}),
    user_message: {
      text: message.text,
      received_at: message.received_at
    }
  };

  const shouldIncludeOwnerReport =
    (senderRole === "owner" || senderRole === "manager") &&
    message.chat_type === "private" &&
    detectOwnerReportIntent(message.text) &&
    reportDataSource !== undefined;

  if (shouldIncludeOwnerReport) {
    context.report_summary = buildOwnerReportSummary(reportDataSource);
  }

  const shouldIncludeDailyReport =
    (senderRole === "owner" || senderRole === "manager") &&
    message.chat_type === "private" &&
    detectDailyReportIntent(message.text) &&
    reportDataSource !== undefined &&
    dailyReportStore !== undefined;

  if (shouldIncludeDailyReport) {
    const maintenanceMode = maintenanceStore?.isEnabled() ?? false;
    context.daily_report = buildDailyOwnerReport(reportDataSource, dailyReportStore, env, maintenanceMode, senderRole, "manual");
  }

  const learningReviewIntent = detectLearningReviewIntent(message.text);
  const shouldIncludeLearningReview = 
    (senderRole === "owner" || senderRole === "manager") &&
    message.chat_type === "private" &&
    learningReviewIntent !== null &&
    ingestionStore !== undefined;

  if (shouldIncludeLearningReview) {
    context.learning_review = buildLearningReviewContext(learningReviewIntent, ingestionStore, senderRole);
  }

  const knowledgeSyncIntent = detectKnowledgeSyncIntent(message.text);
  const shouldIncludeKnowledgeSync =
    (senderRole === "owner" || senderRole === "manager") &&
    message.chat_type === "private" &&
    knowledgeSyncIntent &&
    ingestionStore !== undefined;

  if (shouldIncludeKnowledgeSync) {
    context.knowledge_sync = buildKnowledgeSyncContext(message.text, senderRole, ingestionStore);
  }

  const knowledgePublishIntent = detectKnowledgePublishIntent(message.text);
  const shouldIncludeKnowledgePublish =
    (senderRole === "owner" || senderRole === "manager") &&
    message.chat_type === "private" &&
    knowledgePublishIntent &&
    ingestionStore !== undefined;

  if (shouldIncludeKnowledgePublish) {
    context.knowledge_publish = buildKnowledgePublishContext(knowledgePublishIntent, senderRole, ingestionStore, env);
  }

  if (senderRole === "owner" || senderRole === "manager") {
    context.owner_instruction_override = {
      rule: "If owner provides a new app/platform name, invite code, setup requirement, or profile photo rule, do NOT say it needs backend approval. Instead, acknowledge the instruction neutrally without using a title or nickname. Put a JSON object in internal_boss_note with type 'owner_platform_update_candidate', app_name, invite_code, setup_requirement, profile_photo_required, agency_code, target_action: 'create_pending_learning_suggestion', requires_owner_review: true. You MUST NOT say 'I cannot do this'. Manager requires owner review.",
      supported_intents: ["ekle", "bunu sisteme ekle", "onay benim", "onay bende", "ben onay veriyorum", "bilgi bankasına al", "uygulama listesine ekle", "davet kodu", "kurulum bilgisi", "profil fotoğrafı eklenmeli", "bu platform aktif", "bizde aktif", "ajans kullanıyor", "backend’e ekle", "başkent"]
    };
  } else if (senderRole === "candidate") {
    context.candidate_instruction_override = {
      reply_style: "Keep replies very short, WhatsApp style. Direct answers. NO long paragraphs. If the user asks a direct question (e.g., FAQ, limits, payment), ANSWER THAT QUESTION DIRECTLY first. Do NOT repeat the expected_next_step or onboarding instructions unless they explicitly ask what to do next. Prioritize their last question over our onboarding process.",
      last_question_priority: true,
      repetition_guard: true
    };
  }

  return context;
}
