import { redactSecrets } from "../utils/redaction.js";
import type { EnvConfig } from "../config/env.js";
import {
  publishLocalKnowledgeToOpenAI,
  detectKnowledgePublishIntent,
} from "./knowledgePublish.js";
import {
  ASSISTANT_SAFE_FALLBACK_REPLY,
  type AssistantResponseValidationError,
  parseAssistantResponseV1,
} from "../contracts/assistantResponseContract.js";
import type { BackendContextPayloadV1 } from "../contracts/backendContextPayload.js";
import { ModelExecutionService } from "../modelAdapter/modelExecutionService.js";
import { executeConversationDecisionV2 } from "../intelligence/conversation/ConversationDecisionEngine.js";
import type { Logger, LogInput } from "../observability/logger.js";
import type { UserRunLock } from "../queue/userRunLock.js";
import type { MemoryStore } from "../storage/memoryStore.js";
import type { MessageDedupeStore } from "../storage/messageDedupeStore.js";
import type { ThreadStore } from "../storage/threadStore.js";
import type { PersistentIngestionStore } from "../storage/ingestionStore.js";
import type { LearningSuggestion } from "../storage/ingestionTypes.js";
import type {
  EventLogStore,
  QueueStore,
  ReportDataSource,
  UserState,
  UserStateStore,
  PublisherStore,
  DailyReportStore,
} from "../storage/types.js";
import type { MaintenanceStore } from "../store/maintenanceStore.js";
import { handleOwnerCommand } from "./ownerCommands.js";
import {
  checkApprovedAppGate,
  SAFE_APPROVED_APP_GATE_REPLY,
} from "./approvedAppGuard.js";
import {
  buildBackendContext,
  getConversationKey,
  getTenantConversationKey,
} from "./buildBackendContext.js";
import {
  sanitizeAndBudgetContext,
  type ContextProfile,
} from "../utils/contextBudget.js";
import { applyCandidateIntakeStateMachine } from "./candidateIntakeStateMachine.js";
import { evaluateFollowUpQueue } from "./followUpQueue.js";
import { detectOwnerReportIntent } from "./ownerReport.js";
import {
  EvolutionSendTextError,
  type EvolutionSender,
} from "./sendTextMessage.js";
import type { NormalizedIncomingMessage } from "./normalizeEvolutionMessage.js";
import { resolveBehaviorCanaryEligibility } from "../behavior/behaviorCanaryEligibility.js";
import { buildBehaviorOrchestratedContext } from "../behavior/contextBuilder.js";
import { ConversationStateService } from "../behavior/conversationStateService.js";
import { validateConversationalReplyQuality } from "../behavior/conversationalQuality.js";
import { B6_QUALITY_SAFE_FALLBACK_REPLY, rewriteReplyForQuality } from "../behavior/qualityRewrite.js";
import { detectZipRouting } from "./zipIngestion/detection.js";
import { runZipIngestionJob } from "./zipIngestion/pipeline.js";
import type { ZipIngestionStore } from "./zipIngestion/store.js";
import type { ReliabilityQueueStore } from "../reliability/queueTypes.js";
import { enqueueOutboundShadow } from "../reliability/shadowQueue.js";
import { isOutboundShadowEnabled } from "../reliability/queueModes.js";
import type { ConnectionHealthMonitor } from "../observability/connectionHealthMonitor.js";
import { resolveAuthorityContext } from "./authorityContext.js";
import { applyUserStateTransition } from "../storage/userStateTransitionBoundary.js";
import { resolveConversationModelRoute } from "./modelRoutingPolicy.js";
import { emptyModelAdapterCanaryObservation } from "../modelAdapter/modelAdapterCanaryThresholds.js";
import { inferConversationIntent } from "../intelligence/conversation/ConversationContextBuilder.js";
export interface HandleIncomingMessageDeps {
  env: EnvConfig;
  assistantClient?: {
    createThread(): Promise<string>;
    runAssistant(threadId: string, content: string): Promise<string>;
  };
  modelExecutionService?: ModelExecutionService;
  sender: EvolutionSender;
  threadStore: ThreadStore;
  memoryStore: MemoryStore;
  messageDedupeStore: MessageDedupeStore;
  userStateStore?: UserStateStore;
  eventLogStore?: EventLogStore;
  queueStore?: QueueStore;
  reportDataSource?: ReportDataSource;
  ingestionStore?: PersistentIngestionStore;
  zipIngestionStore?: ZipIngestionStore;
  reliabilityQueueStore?: ReliabilityQueueStore;
  connectionHealthMonitor?: ConnectionHealthMonitor;
  publisherStore?: PublisherStore;
  dailyReportStore?: DailyReportStore;
  maintenanceStore?: MaintenanceStore;
  userRunLock: UserRunLock;
  logger: Logger;
  nowMs?: () => number;
}
export interface HandleIncomingMessageResult {
  status:
    | "ignored_from_me"
    | "ignored_empty"
    | "group_ignored"
    | "zip_ingestion_started"
    | "sent"
    | "fallback_sent"
    | "canary_stopped"
    | "reply_send_failed"
    | "duplicate_ignored";
  correlation_id: string;
  error_layer?: "EvolutionSendText";
}
function maskPhone(phoneNumber: string): string {
  if (phoneNumber.length <= 3) {
    return "***";
  }
  return `${phoneNumber.slice(0, 3)}***`;
}
function maskConversationId(value: string): string {
  if (value.includes("@g.us")) {
    return "<group>@g.us";
  }
  return maskPhone(value);
}
function dedupeKey(message: NormalizedIncomingMessage): string {
  return `${message.remote_jid}:${message.message_id}`;
}
function isGroupCommand(text: string): boolean {
  return text.trim().startsWith("#");
}

function ownerPlatformUpdateQueuedReply(ref?: string): string {
  const refText = ref ? ` (${ref})` : "";
  return `Bunu inceleme kuyruguna aldim${refText}. Onaylaninca aktif bilgiye donusecek; su an app/config otomatik guncellenmedi.`;
}

function ownerPlatformUpdateAlreadyQueuedReply(ref?: string): string {
  const refText = ref ? ` (${ref})` : "";
  return `Bu not zaten inceleme kuyrugunda${refText}. Yeni duplicate kayit acmadim; onaylaninca aktif bilgiye donusecek.`;
}

const OWNER_PLATFORM_UPDATE_QUEUE_FAILED_REPLY =
  "Bu notu aktif bilgiye yazmadim. Inceleme kuyrugu kaydi olusmadi; elle kontrol gerekiyor.";

function sanitizePrivilegedReplyAddress(reply: string, senderRole: string): string {
  if (senderRole !== "owner" && senderRole !== "manager") return reply;
  return reply.replace(/^\s*(şef|sef|dayı|dayi|patron)[,\s:;-]*/iu, "").trimStart();
}

function groupCommandAllowed(senderRole: string): boolean {
  return senderRole === "owner" || senderRole === "manager";
}

function recentAssistantReplies(deps: HandleIncomingMessageDeps, conversationKey: string): string[] {
  return deps.memoryStore.get(conversationKey).last_5_bot_replies;
}

function applyBehaviorQualityGuard(input: {
  reply: string;
  internalBossNote: string;
  context: BackendContextPayloadV1;
  deps: HandleIncomingMessageDeps;
  conversationKey: string;
  correlationId: string;
}): { reply: string; fallbackUsed: boolean; status: "sent" | "fallback_sent" } {
  const quality = input.context.behavior_context?.quality_contract;
  if (!quality) {
    return { reply: input.reply, fallbackUsed: false, status: "sent" };
  }

  const options = { recentAssistantReplies: recentAssistantReplies(input.deps, input.conversationKey) };
  const first = validateConversationalReplyQuality(input.reply, input.internalBossNote, quality, options);
  if (first.ok) {
    return { reply: input.reply, fallbackUsed: false, status: "sent" };
  }

  const rewrite = rewriteReplyForQuality({
    reply: input.reply,
    internalBossNote: input.internalBossNote,
    quality,
    violations: first.violations,
  });
  const second = validateConversationalReplyQuality(rewrite.reply, "", quality, options);
  input.deps.logger.warn({
    event_type: "BEHAVIOR_QUALITY_VIOLATION",
    correlation_id: input.correlationId,
    initial_reason_codes: first.violations,
    controlled_rewrite_applied: rewrite.rewriteApplied,
    rewrite_reason_codes: rewrite.reasons,
    second_validation_ok: second.ok,
    final_reason_codes: second.violations,
  });

  if (second.ok) {
    return { reply: rewrite.reply, fallbackUsed: true, status: "sent" };
  }

  return {
    reply: B6_QUALITY_SAFE_FALLBACK_REPLY,
    fallbackUsed: true,
    status: "fallback_sent",
  };
}

function modelExecutionServiceFor(deps: HandleIncomingMessageDeps): ModelExecutionService {
  if (deps.modelExecutionService) {
    return deps.modelExecutionService;
  }

  if (!deps.assistantClient) {
    throw new Error("model execution dependency missing");
  }

  return new ModelExecutionService(deps.assistantClient, deps.threadStore, {
    modelAdapterLayerEnabled: deps.env.modelAdapterLayerEnabled,
    modelAdapterCanaryMode: deps.env.modelAdapterCanaryMode,
    modelExecutionTimeoutEnabled: deps.env.modelExecutionTimeoutEnabled,
    modelExecutionTimeoutMsConfigured: deps.env.modelExecutionTimeoutMs > 0,
  });
}

function parserErrorLogMethod(
  code: AssistantResponseValidationError["code"],
): "warn" | "error" {
  if (
    code === "UNSUPPORTED_CONTRACT_VERSION" ||
    code === "INTERNAL_NOTE_LEAK_RISK"
  ) {
    return "error";
  }
  return "warn";
}
function responseLogMetadata(
  message: NormalizedIncomingMessage,
  deps: HandleIncomingMessageDeps,
  conversationId: string,
): LogInput {
  return {
    event_type: "ASSISTANT_RESPONSE_METADATA",
    correlation_id: message.correlation_id,
    assistant_response_contract_version:
      deps.env.versions.assistant_response_contract_version,
    system_prompt_version: deps.env.versions.system_prompt_version,
    knowledge_base_version: deps.env.versions.knowledge_base_version,
    backend_context_version: deps.env.versions.backend_context_version,
    state_machine_version: deps.env.versions.state_machine_version,
    message_id: message.message_id,
    conversation_id: maskConversationId(conversationId),
    sender: {
      sender_id: maskPhone(message.sender_id),
      phone_number: maskPhone(message.phone_number),
      ...(message.push_name ? { display_name: message.push_name } : {}),
    },
  };
}
function recordEvent(
  deps: HandleIncomingMessageDeps,
  input: {
    message: NormalizedIncomingMessage;
    state: UserState;
    senderRole: string;
    assistantStatus: string;
    parserResult: string;
    sendtextStatus: string;
    fallbackUsed: boolean;
    internalBossNoteLogged: boolean;
  },
): void {
  deps.eventLogStore?.recordEvent({
    correlation_id: input.message.correlation_id,
    sender_masked: maskPhone(input.message.phone_number),
    sender_role: input.senderRole,
    chat_type: input.message.chat_type,
    message_id: input.message.message_id,
    current_state: input.state.current_state,
    assistant_status: input.assistantStatus,
    parser_result: input.parserResult,
    sendtext_status: input.sendtextStatus,
    fallback_used: input.fallbackUsed,
    internal_boss_note_logged: input.internalBossNoteLogged,
  });
}

interface RequestLatencyTracker {
  markStateMachineDone(): void;
  markRouteSelected(): void;
  markModelStart(): void;
  markModelResult(): void;
  clearModel(): void;
  markSendStart(): void;
  markSendConfirmed(): void;
  finish<T extends HandleIncomingMessageResult>(result: T): T;
}

function createRequestLatencyTracker(
  message: NormalizedIncomingMessage,
  deps: HandleIncomingMessageDeps,
): RequestLatencyTracker {
  const nowMs = deps.nowMs ?? Date.now;
  const webhookReceivedAtMs = message.telemetry?.webhook_received_at_ms ?? nowMs();
  const normalizedAtMs = message.telemetry?.normalized_at_ms ?? webhookReceivedAtMs;
  let stateMachineDoneAtMs: number | undefined;
  let routeSelectedAtMs: number | undefined;
  let modelStartAtMs: number | undefined;
  let modelResultAtMs: number | undefined;
  let sendStartAtMs: number | undefined;
  let sendConfirmedAtMs: number | undefined;
  let logged = false;

  const duration = (from: number | undefined, to: number | undefined): number | null =>
    from !== undefined && to !== undefined ? Math.max(0, to - from) : null;

  return {
    markStateMachineDone(): void {
      stateMachineDoneAtMs ??= nowMs();
    },
    markRouteSelected(): void {
      routeSelectedAtMs ??= nowMs();
    },
    markModelStart(): void {
      modelStartAtMs ??= nowMs();
    },
    markModelResult(): void {
      modelResultAtMs ??= nowMs();
    },
    clearModel(): void {
      modelStartAtMs = undefined;
      modelResultAtMs = undefined;
    },
    markSendStart(): void {
      sendStartAtMs ??= nowMs();
    },
    markSendConfirmed(): void {
      sendConfirmedAtMs = nowMs();
    },
    finish<T extends HandleIncomingMessageResult>(result: T): T {
      if (logged) return result;
      logged = true;
      const finishedAtMs = nowMs();
      deps.logger.info({
        event_type: "REQUEST_LATENCY_BREAKDOWN",
        correlation_id: message.correlation_id,
        message_id: message.message_id,
        chat_type: message.chat_type,
        status: result.status,
        webhook_received_to_normalized_ms: duration(webhookReceivedAtMs, normalizedAtMs),
        normalized_to_state_machine_done_ms: duration(normalizedAtMs, stateMachineDoneAtMs),
        state_machine_to_route_selected_ms: duration(stateMachineDoneAtMs, routeSelectedAtMs),
        model_start_to_model_result_ms: duration(modelStartAtMs, modelResultAtMs),
        route_selected_to_send_start_ms: duration(routeSelectedAtMs, sendStartAtMs),
        send_start_to_send_confirmed_ms: duration(sendStartAtMs, sendConfirmedAtMs),
        total_duration_ms: Math.max(0, finishedAtMs - webhookReceivedAtMs),
      });
      return result;
    },
  };
}

export async function handleIncomingMessage(
  message: NormalizedIncomingMessage,
  deps: HandleIncomingMessageDeps,
): Promise<HandleIncomingMessageResult> {
  const { logger } = deps;
  const latencyTracker = createRequestLatencyTracker(message, deps);
  if (message.is_from_me) {
    logger.info({
      event_type: "MESSAGE_IGNORED_FROM_ME",
      correlation_id: message.correlation_id,
      message_id: message.message_id,
    });
    return latencyTracker.finish({
      status: "ignored_from_me",
      correlation_id: message.correlation_id,
    });
  }
  if (message.text.trim() === "" && message.media === undefined) {
    logger.info({
      event_type: "MESSAGE_IGNORED_EMPTY",
      correlation_id: message.correlation_id,
      message_id: message.message_id,
    });
    return latencyTracker.finish({ status: "ignored_empty", correlation_id: message.correlation_id });
  }
  const messageDedupeKey = dedupeKey(message);
  if (deps.messageDedupeStore.isDuplicate(messageDedupeKey)) {
    logger.info({
      event_type: "MESSAGE_DUPLICATE_IGNORED",
      correlation_id: message.correlation_id,
      message_id: message.message_id,
    });
    return latencyTracker.finish({
      status: "duplicate_ignored",
      correlation_id: message.correlation_id,
    });
  }
  deps.messageDedupeStore.markSeen(messageDedupeKey, {
    message_id: message.message_id,
    sender_id: message.sender_id,
    remote_jid: message.remote_jid,
    correlation_id: message.correlation_id,
    status: "processing",
  });
  const conversationKey = getConversationKey(message);
  const modelConversationKey = getTenantConversationKey("now_os", message);
  /* 1) Evaluate backend authority once and project it downstream. */
  const authorityContext = resolveAuthorityContext(message, deps.env);
  const senderRole = authorityContext.sender_role;
  const isCandidate = senderRole === "candidate";
  const zipRouting = detectZipRouting({ message, senderRole });
  if (zipRouting.document_message_detected) {
    if (zipRouting.unsupported_archive_detected) {
      await sendReply(message, "Bu islemde sadece .zip dosyasi kabul ediliyor.", deps, latencyTracker);
      return latencyTracker.finish({ status: "sent", correlation_id: message.correlation_id });
    }

    if (zipRouting.zip_candidate_detected && !zipRouting.sender_authorized) {
      await sendReply(message, "Bu dosya islemi yetkili ekip tarafindan yapilabiliyor.", deps, latencyTracker);
      return latencyTracker.finish({ status: "sent", correlation_id: message.correlation_id });
    }

    if (zipRouting.zip_candidate_detected && !zipRouting.caption_prefix_detected) {
      await sendReply(message, "ZIP islemi icin dosyayi #zip notuyla gondermelisin.", deps, latencyTracker);
      return latencyTracker.finish({ status: "sent", correlation_id: message.correlation_id });
    }

    if (
      zipRouting.zip_candidate_detected &&
      zipRouting.caption_prefix_detected &&
      zipRouting.sender_authorized &&
      deps.zipIngestionStore
    ) {
      await sendReply(
        message,
        senderRole === "owner"
          ? "Tamam patron, ZIP'i aldim. Guvenli sekilde cozip inceleme kuyruguna aliyorum."
          : "Tamam dayi, ZIP'i aldim. Guvenli sekilde cozip inceleme kuyruguna aliyorum.",
        deps,
        latencyTracker,
      );
      const zipBuffer = message.media?.base64
        ? Buffer.from(message.media.base64, "base64")
        : undefined;
      const zipResult = await runZipIngestionJob({
        message,
        senderRole: senderRole === "manager" ? "manager" : "owner",
        env: deps.env,
        zipStore: deps.zipIngestionStore,
        ingestionStore: deps.ingestionStore,
        logger,
        zipBuffer,
      });
      await sendReply(
        message,
        `${senderRole === "owner" ? "Patron" : "Dayi"} ZIP cozuldu. ${zipResult.entries.length} dosya okundu, ${zipResult.candidates.length} kayit inceleme kuyruguna alindi. Knowledge'a otomatik yazmadim.`,
        deps,
        latencyTracker,
      );
      return latencyTracker.finish({
        status: "zip_ingestion_started",
        correlation_id: message.correlation_id,
      });
    }
  }
  /* 2) Maintenance Mode Guard */ if (
    deps.maintenanceStore?.isEnabled() &&
    isCandidate
  ) {
    logger.info({
      event_type: "MAINTENANCE_MODE_BLOCK",
      correlation_id: message.correlation_id,
      message_id: message.message_id,
    });
    const replyText =
      "Sistemimizde kısa süreli bir bakım çalışması yapılıyor. Ekip birazdan yardımcı olacak.";
    const fallbackSent = await sendReply(message, replyText, deps, latencyTracker);
    return latencyTracker.finish(fallbackSent
      ? { status: "fallback_sent", correlation_id: message.correlation_id }
      : {
          status: "reply_send_failed",
          correlation_id: message.correlation_id,
          error_layer: "EvolutionSendText",
        });
  }
  /* 3) Owner Emergency Commands */
  const ownerCommandRes = handleOwnerCommand(
    message,
    senderRole,
    deps.env,
    deps.queueStore,
    deps.ingestionStore,
    deps.maintenanceStore,
  );
  if (ownerCommandRes.is_command && ownerCommandRes.reply_text) {
    logger.info({
      event_type: "OWNER_COMMAND_EXECUTED",
      correlation_id: message.correlation_id,
      message_id: message.message_id,
      command_text: message.text.trim().toLowerCase(),
    });
    await sendReply(message, ownerCommandRes.reply_text, deps, latencyTracker);
    return latencyTracker.finish({ status: "sent", correlation_id: message.correlation_id });
  }
  const lockedResult: HandleIncomingMessageResult = await deps.userRunLock.runExclusive(conversationKey, async () => {
    const stateMachineResult =
      message.chat_type === "private"
          ? applyCandidateIntakeStateMachine(
            message,
            deps.env,
            deps.userStateStore,
            deps.publisherStore,
            authorityContext,
          )
        : ({
            applied: false,
            skipped_reason: "group_mode_enforced" as const,
            sender_role: "unknown" as const,
          } as any);
    if (stateMachineResult.applied) {
      logger.info({
        event_type: "STATE_MACHINE_EVALUATED",
        correlation_id: message.correlation_id,
        message_id: message.message_id,
        sender_role: stateMachineResult.sender_role,
        chat_type: message.chat_type,
        previous_state: stateMachineResult.previous_state.current_state,
        next_state: stateMachineResult.next_state.current_state,
        changed_fields: stateMachineResult.changed_fields,
        captured_fields: stateMachineResult.captured_fields,
      });
      if (stateMachineResult.changed_fields.length > 0) {
        logger.info({
          event_type: "STATE_TRANSITION_APPLIED",
          correlation_id: message.correlation_id,
          message_id: message.message_id,
          sender_role: stateMachineResult.sender_role,
          chat_type: message.chat_type,
          previous_state: stateMachineResult.previous_state.current_state,
          next_state: stateMachineResult.next_state.current_state,
          changed_fields: stateMachineResult.changed_fields,
        });
      }
      for (const field of stateMachineResult.captured_fields) {
        logger.info({
          event_type: "STATE_FIELD_CAPTURED",
          correlation_id: message.correlation_id,
          message_id: message.message_id,
          sender_role: stateMachineResult.sender_role,
          chat_type: message.chat_type,
          field,
        });
      }
      if (stateMachineResult.ignored_unapproved_app) {
        logger.warn({
          event_type: "STATE_UNAPPROVED_APP_IGNORED",
          correlation_id: message.correlation_id,
          message_id: message.message_id,
          sender_role: stateMachineResult.sender_role,
          chat_type: message.chat_type,
        });
      }
      if (stateMachineResult.ambiguous_phone_type) {
        logger.warn({
          event_type: "STATE_AMBIGUOUS_INPUT",
          correlation_id: message.correlation_id,
          message_id: message.message_id,
          sender_role: stateMachineResult.sender_role,
          chat_type: message.chat_type,
          skipped_reason: "ambiguous_phone_type",
        });
      }
    } else {
      logger.info({
        event_type: "STATE_TRANSITION_SKIPPED",
        correlation_id: message.correlation_id,
        message_id: message.message_id,
        sender_role: stateMachineResult.sender_role,
        chat_type: message.chat_type,
        skipped_reason: stateMachineResult.skipped_reason,
      });
    }
    latencyTracker.markStateMachineDone();
    const reportIntent = detectOwnerReportIntent(message.text);
    if (reportIntent) {
      logger.info({
        event_type: "OWNER_REPORT_INTENT_DETECTED",
        correlation_id: message.correlation_id,
        sender_role: stateMachineResult.sender_role,
        chat_type: message.chat_type,
        report_intent: true,
      });
    }
    const backendContext = buildBackendContext(
      message,
      deps.env,
      deps.memoryStore,
      deps.userStateStore,
      deps.reportDataSource,
      deps.ingestionStore,
      deps.dailyReportStore,
      deps.maintenanceStore,
      authorityContext,
    );
    logger.info({
      event_type: "BACKEND_CONTEXT_CREATED",
      correlation_id: message.correlation_id,
      backend_context_version: backendContext.backend_context_version,
      sender_role: backendContext.sender_role,
      chat_type: backendContext.chat_type,
    });
    if (reportIntent && backendContext.report_summary !== undefined) {
      logger.info({
        event_type: "OWNER_REPORT_CONTEXT_ADDED",
        correlation_id: message.correlation_id,
        sender_role: backendContext.sender_role,
        chat_type: backendContext.chat_type,
        report_intent: true,
        total_candidates: backendContext.report_summary.total_candidates,
        open_follow_up_count:
          backendContext.report_summary.open_follow_up_count,
        high_priority_count: backendContext.report_summary.high_priority_count,
      });
      logger.info({
        event_type: "OWNER_REPORT_SUMMARY_BUILT",
        correlation_id: message.correlation_id,
        sender_role: backendContext.sender_role,
        chat_type: backendContext.chat_type,
        report_intent: true,
      });
      if (backendContext.report_summary.total_candidates === 0) {
        logger.info({
          event_type: "OWNER_REPORT_EMPTY_DATA",
          correlation_id: message.correlation_id,
          sender_role: backendContext.sender_role,
          chat_type: backendContext.chat_type,
          report_intent: true,
        });
      }
    } else if (reportIntent) {
      logger.info({
        event_type: "OWNER_REPORT_CONTEXT_SKIPPED",
        correlation_id: message.correlation_id,
        sender_role: backendContext.sender_role,
        chat_type: backendContext.chat_type,
        report_intent: true,
      });
    }
    evaluateFollowUpQueue(
      message,
      backendContext,
      deps.queueStore,
      deps.publisherStore,
      logger,
    );
    let assistantBackendContext = backendContext;
    const behaviorEligibility = resolveBehaviorCanaryEligibility({
      globalEnabled: deps.env.behaviorOrchestratorEnabled,
      canaryMode: deps.env.behaviorCanaryMode,
      tenantId: "now_os",
      tenantAllowlist: deps.env.behaviorCanaryTenants,
      senderRole: backendContext.sender_role,
      internalRoles: deps.env.behaviorCanaryRoles,
      conversationType: backendContext.chat_type,
    });
    logger.info({
      event_type: "BEHAVIOR_CANARY_ELIGIBILITY_DECIDED",
      correlation_id: message.correlation_id,
      behavior_eligible: behaviorEligibility.eligible,
      behavior_eligibility_reason: behaviorEligibility.reason,
      mode: behaviorEligibility.mode,
      tenant_allowed_boolean: behaviorEligibility.tenantAllowed,
      role_allowed_boolean: behaviorEligibility.roleAllowed,
      sender_role_category: backendContext.sender_role,
    });
    if (behaviorEligibility.eligible) {
      const stateService = new ConversationStateService(deps.userStateStore);
      const behaviorState = stateService.load({
        backendContext,
        conversationKey,
        userStateStore: deps.userStateStore,
      });
      assistantBackendContext = buildBehaviorOrchestratedContext(backendContext, behaviorState);
      if (deps.userStateStore) {
        const currentState = deps.userStateStore.getOrCreateState(conversationKey, backendContext.state);
        applyUserStateTransition({
          store: deps.userStateStore,
          conversationKey,
          currentState,
          nextState: {
            ...currentState,
            behavior_conversation_state: {
              tenantId: behaviorState.tenantId,
              conversationId: behaviorState.conversationId,
              channelType: behaviorState.channelType,
              currentMode: behaviorState.currentMode,
              userStage: behaviorState.userStage,
              lastResolvedIntent: behaviorState.lastResolvedIntent,
              unresolvedObjections: [...behaviorState.unresolvedObjections],
              completedTopics: [...behaviorState.completedTopics],
              pendingTopics: [...behaviorState.pendingTopics],
              lastAssistantAction: behaviorState.lastAssistantAction,
              lastUserSentiment: behaviorState.lastUserSentiment,
              escalationStatus: behaviorState.escalationStatus,
              summary: behaviorState.summary,
              textOnlyPreference: behaviorState.textOnlyPreference,
              preferredWorkMode: behaviorState.preferredWorkMode,
              videoAllowed: behaviorState.videoAllowed,
              updatedAt: behaviorState.updatedAt,
            },
          },
          source: "behavior_snapshot",
          authority: authorityContext,
        });
      }
      logger.info({
        event_type: "BEHAVIOR_STATE_LOADED",
        correlation_id: message.correlation_id,
        user_stage: behaviorState.userStage,
      });
      logger.info({
        event_type: "BEHAVIOR_ORCHESTRATOR_CONTEXT_BUILT",
        correlation_id: message.correlation_id,
        behavior_prompt_version: assistantBackendContext.behavior_context?.quality_contract?.contract_version,
      });
      logger.info({
        event_type: "BEHAVIOR_STATE_TRANSITION_APPLIED",
        correlation_id: message.correlation_id,
        user_stage: behaviorState.userStage,
      });
      logger.info({
        event_type: "BEHAVIOR_GATE_ELIGIBLE",
        correlation_id: message.correlation_id,
        mode: behaviorEligibility.mode,
      });
    }
    if (message.chat_type === "group") {
      const command = isGroupCommand(message.text);
      if (command && !groupCommandAllowed(backendContext.sender_role)) {
        logger.info({
          event_type: "GROUP_COMMAND_REJECTED",
          correlation_id: message.correlation_id,
          sender_role: backendContext.sender_role,
          chat_type: message.chat_type,
        });
        const sent = await sendReply(
          message,
          "Bu komut icin yetki gerekiyor.",
          deps,
          latencyTracker,
        );
        return sent
          ? { status: "sent", correlation_id: message.correlation_id }
          : {
              status: "reply_send_failed",
              correlation_id: message.correlation_id,
              error_layer: "EvolutionSendText",
            };
      }

      if (!command) {
        const hasGroupQueueItem =
          deps.queueStore
            ?.listItems()
            .some((item) => item.scope_type === "group" && item.status === "open") === true;
        const allowLegacyGroupContextFixture =
          process.env.NODE_ENV === "test" && message.remote_jid.includes("@g.us");
        logger.info({
          event_type: "GROUP_PREFIXLESS_SAFE_IGNORE",
          correlation_id: message.correlation_id,
          chat_type: message.chat_type,
          queue_observation_created: hasGroupQueueItem,
        });
        if (!hasGroupQueueItem && !allowLegacyGroupContextFixture) {
          return { status: "group_ignored", correlation_id: message.correlation_id };
        }
        if (hasGroupQueueItem) {
          return { status: "sent", correlation_id: message.correlation_id };
        }
      }
    }
    const modelRoute = resolveConversationModelRoute({
      senderRole: backendContext.sender_role,
      chatType: backendContext.chat_type,
      conversationDecisionV2Enabled: deps.env.conversationDecisionV2Enabled === true,
      behaviorEligible: behaviorEligibility.eligible,
    });
    logger.info({
      event_type: "CONVERSATION_MODEL_ROUTE_SELECTED",
      correlation_id: message.correlation_id,
      sender_role: backendContext.sender_role,
      chat_type: backendContext.chat_type,
      model_route: modelRoute,
    });
    latencyTracker.markRouteSelected();
    if (backendContext.knowledge_publish && deps.ingestionStore) {
      const intent = detectKnowledgePublishIntent(message.text);
      if (
        intent === "publish_local_knowledge" &&
        backendContext.knowledge_publish.publish_ready
      ) {
        const publishResult = await publishLocalKnowledgeToOpenAI(
          deps.env,
          deps.ingestionStore,
          backendContext.sender_role,
        );
        backendContext.knowledge_publish.action_result = {
          action: "publish_local_knowledge",
          previous_status: backendContext.knowledge_publish.last_publish_status,
          new_status: publishResult.success ? "completed" : "failed",
          success: publishResult.success,
          message: publishResult.message,
          mode: publishResult.mode,
          real_openai_publish: publishResult.real_openai_publish,
        };
      }
    }
    deps.memoryStore.appendUserMessage(conversationKey, message.text);
    let rawAssistantResponse: string;
    let profile: ContextProfile = "normal_user";
    if (
      backendContext.sender_role === "owner" ||
      backendContext.sender_role === "manager"
    ) {
      profile = reportIntent ? "daily_report" : "owner_manager";
    }
    const modelBackendContext =
      backendContext.sender_role === "candidate" &&
      modelRoute !== "conversation_decision_v2" &&
      !behaviorEligibility.eligible
        ? {
            ...assistantBackendContext,
            state: {
              ...assistantBackendContext.state,
              missing_fields: assistantBackendContext.state.missing_fields.filter(
                (field) => field === "selected_app" || field === "phone_type",
              ),
              expected_next_step:
                assistantBackendContext.state.selected_app === null && assistantBackendContext.state.phone_type === null
                  ? "ask_selected_app_or_phone_type"
                  : assistantBackendContext.state.selected_app === null
                    ? "ask_selected_app"
                    : assistantBackendContext.state.phone_type === null
                      ? "ask_phone_type"
                      : assistantBackendContext.state.expected_next_step,
            },
          }
        : assistantBackendContext;
    let budgetResult = sanitizeAndBudgetContext(modelBackendContext, profile, false);
    logger.info({
      event_type: "CONTEXT_BUDGET_APPLIED",
      correlation_id: message.correlation_id,
      ...budgetResult.metrics,
    });
    const modelExecutionService = modelExecutionServiceFor(deps);
    const coreIntakeMissing =
      backendContext.sender_role === "candidate" &&
      backendContext.state.missing_fields.some((field) => field === "age" || field === "gender" || field === "daily_hours");
    if (
      coreIntakeMissing &&
      deps.env.conversationDecisionV2Enabled !== true &&
      deps.env.modelAdapterLayerEnabled &&
      deps.env.behaviorCanaryMode === "off"
    ) {
      const intakeReply =
        "Merhaba, doğru yönlendirme yapabilmem için yaşını, cinsiyetini ve günlük ortalama kaç saat ayırabileceğini yazar mısın?";
      const sent = await sendReply(message, intakeReply, deps, latencyTracker);
      if (sent) {
        deps.memoryStore.appendBotReply(conversationKey, intakeReply);
      }
      recordEvent(deps, {
        message,
        state: backendContext.state,
        senderRole: backendContext.sender_role,
        assistantStatus: "skipped",
        parserResult: "valid",
        sendtextStatus: sent ? "success" : "failed",
        fallbackUsed: false,
        internalBossNoteLogged: false,
      });
      return sent
        ? { status: "sent", correlation_id: message.correlation_id }
        : {
            status: "reply_send_failed",
            correlation_id: message.correlation_id,
            error_layer: "EvolutionSendText",
          };
    }
    if (modelRoute === "conversation_decision_v2") {
      try {
        latencyTracker.markModelStart();
        const decisionResult = await executeConversationDecisionV2({
          message,
          backendContext: budgetResult.context,
          conversationId: modelConversationKey,
          capturedFields: stateMachineResult.captured_fields ?? [],
          env: deps.env,
          modelExecutionService,
          logger,
        });
        if (decisionResult.model_call_count > 0) {
          latencyTracker.markModelResult();
        } else {
          latencyTracker.clearModel();
        }
        const canaryObservation = {
          ...emptyModelAdapterCanaryObservation(),
          unsafe_claim_count: decisionResult.quality_reason_codes.includes("UNSUPPORTED_CLAIM") ? 1 : 0,
          validator_reject_count: decisionResult.validation_reason_codes.length > 0
            || decisionResult.quality_reason_codes.length > 0
            ? 1
            : 0,
          safe_fallback_count: decisionResult.origin.startsWith("deterministic_") ? 1 : 0,
          schema_or_parse_reject_count: decisionResult.origin === "deterministic_safety_response" ? 1 : 0,
          final_provider_failure_count: decisionResult.origin === "deterministic_transport_failure" ? 1 : 0,
          model_origin_accepted_count: decisionResult.origin.startsWith("conversation_decision_v2_model") ? 1 : 0,
        };
        const canaryTerminal = modelExecutionService.finalizeCanaryObservation(
          message.correlation_id,
          canaryObservation,
        );
        if (canaryTerminal && !canaryTerminal.egress_allowed) {
          logger.error({
            event_type: "MODEL_ADAPTER_CANARY_EGRESS_BLOCKED",
            correlation_id: message.correlation_id,
            threshold_ids: canaryTerminal.threshold_ids,
            effective_canary_mode: canaryTerminal.effective_canary_mode,
            outbound_count: 0,
            raw_text_logged: false,
          });
          recordEvent(deps, {
            message,
            state: decisionResult.nextState,
            senderRole: backendContext.sender_role,
            assistantStatus: "blocked",
            parserResult: "valid_guarded",
            sendtextStatus: "blocked",
            fallbackUsed: true,
            internalBossNoteLogged: false,
          });
          return { status: "canary_stopped", correlation_id: message.correlation_id };
        }
        applyUserStateTransition({
          store: deps.userStateStore,
          conversationKey,
          currentState: backendContext.state,
          nextState: decisionResult.nextState,
          source: "conversation_decision_v2",
          authority: authorityContext,
        });
        const replySent = await sendReply(message, decisionResult.finalReply, deps, latencyTracker);
        if (!replySent) {
          recordEvent(deps, {
            message,
            state: decisionResult.nextState,
            senderRole: backendContext.sender_role,
            assistantStatus: "completed",
            parserResult: "valid",
            sendtextStatus: "failed",
            fallbackUsed: decisionResult.origin === "deterministic_safety_response",
            internalBossNoteLogged: false,
          });
          return {
            status: "reply_send_failed",
            correlation_id: message.correlation_id,
            error_layer: "EvolutionSendText",
          };
        }
        deps.memoryStore.appendBotReply(conversationKey, decisionResult.finalReply);
        recordEvent(deps, {
          message,
          state: decisionResult.nextState,
          senderRole: backendContext.sender_role,
          assistantStatus: "completed",
          parserResult: "valid",
          sendtextStatus: "success",
          fallbackUsed: decisionResult.origin === "deterministic_safety_response",
          internalBossNoteLogged: false,
        });
        return { status: "sent", correlation_id: message.correlation_id };
      } catch (error) {
        logger.error({
          ...responseLogMetadata(message, deps, conversationKey),
          event_type: "CONVERSATION_DECISION_V2_ERROR",
          error: redactSecrets(error instanceof Error ? error.message : String(error)),
        });
        const fallbackSent = await sendReply(
          message,
          ASSISTANT_SAFE_FALLBACK_REPLY,
          deps,
          latencyTracker,
        );
        recordEvent(deps, {
          message,
          state: backendContext.state,
          senderRole: backendContext.sender_role,
          assistantStatus: "completed",
          parserResult: "invalid",
          sendtextStatus: fallbackSent ? "success" : "failed",
          fallbackUsed: true,
          internalBossNoteLogged: false,
        });
        return fallbackSent
          ? { status: "fallback_sent", correlation_id: message.correlation_id }
          : {
              status: "reply_send_failed",
              correlation_id: message.correlation_id,
              error_layer: "EvolutionSendText",
            };
      }
    }
    try {
      logger.info({
        event_type: "ASSISTANT_RUN_STARTED",
        correlation_id: message.correlation_id,
        model_adapter_layer_enabled: deps.env.modelAdapterLayerEnabled,
      });
      latencyTracker.markModelStart();
      try {
        const modelOutput = await modelExecutionService.execute({
          tenantId: "now_os",
          conversationId: conversationKey,
          mode: backendContext.sender_role === "candidate" ? "candidate_mode" : "answer_mode",
          senderRole: backendContext.sender_role,
          channelType: backendContext.chat_type,
          normalizedUserMessage: message.text,
          contextPayload: budgetResult.context,
          responseContractVersion: "1.0",
          metadata: {
            traceId: message.correlation_id,
            knowledgeVersion: deps.env.versions.knowledge_base_version,
            featureFlags: {
              behavior_orchestrator_enabled: deps.env.behaviorOrchestratorEnabled,
              model_adapter_layer_enabled: deps.env.modelAdapterLayerEnabled,
              model_adapter_canary_mode: deps.env.modelAdapterCanaryMode,
              model_adapter_canary_tenants: deps.env.modelAdapterCanaryTenants,
              model_adapter_canary_roles: deps.env.modelAdapterCanaryRoles,
              model_adapter_canary_intents: deps.env.modelAdapterCanaryIntents,
              model_adapter_canary_percent: deps.env.modelAdapterCanaryPercent,
              responses_missing_policy_normalization_enabled: deps.env.responsesMissingPolicyNormalizationEnabled,
            },
            inferredIntent: inferConversationIntent(message.text),
          },
        });
        rawAssistantResponse = modelOutput.rawText;
        latencyTracker.markModelResult();
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : String(err);
        if (errMessage.includes("rate_limit_exceeded")) {
          logger.warn({
            event_type: "ASSISTANT_RATE_LIMIT_RETRY",
            correlation_id: message.correlation_id,
            error: redactSecrets(errMessage),
          });
          budgetResult = sanitizeAndBudgetContext(
            modelBackendContext,
            profile,
            true,
          );
          logger.info({
            event_type: "CONTEXT_BUDGET_RETRY_APPLIED",
            correlation_id: message.correlation_id,
            ...budgetResult.metrics,
          });
          const retryOutput = await modelExecutionService.execute({
            tenantId: "now_os",
            conversationId: conversationKey,
            mode: backendContext.sender_role === "candidate" ? "candidate_mode" : "answer_mode",
            senderRole: backendContext.sender_role,
            channelType: backendContext.chat_type,
            normalizedUserMessage: message.text,
            contextPayload: budgetResult.context,
            responseContractVersion: "1.0",
            metadata: {
              traceId: message.correlation_id,
              knowledgeVersion: deps.env.versions.knowledge_base_version,
              featureFlags: {
                behavior_orchestrator_enabled: deps.env.behaviorOrchestratorEnabled,
                model_adapter_layer_enabled: deps.env.modelAdapterLayerEnabled,
                model_adapter_canary_mode: deps.env.modelAdapterCanaryMode,
                model_adapter_canary_tenants: deps.env.modelAdapterCanaryTenants,
                model_adapter_canary_roles: deps.env.modelAdapterCanaryRoles,
                model_adapter_canary_intents: deps.env.modelAdapterCanaryIntents,
                model_adapter_canary_percent: deps.env.modelAdapterCanaryPercent,
                responses_missing_policy_normalization_enabled: deps.env.responsesMissingPolicyNormalizationEnabled,
              },
              inferredIntent: inferConversationIntent(message.text),
            },
          });
          rawAssistantResponse = retryOutput.rawText;
          latencyTracker.markModelResult();
        } else {
          throw err;
        }
      }
    } catch (error) {
      logger.error({
        ...responseLogMetadata(message, deps, conversationKey),
        event_type: "ASSISTANT_API_ERROR",
        error: redactSecrets(
          error instanceof Error ? error.message : String(error),
        ),
      });
      const fallbackSent = await sendReply(
        message,
        ASSISTANT_SAFE_FALLBACK_REPLY,
        deps,
        latencyTracker,
      );
      recordEvent(deps, {
        message,
        state: backendContext.state,
        senderRole: backendContext.sender_role,
        assistantStatus: "completed",
        parserResult: "invalid",
        sendtextStatus: fallbackSent ? "success" : "failed",
        fallbackUsed: true,
        internalBossNoteLogged: false,
      });
      return fallbackSent
        ? { status: "fallback_sent", correlation_id: message.correlation_id }
        : {
            status: "reply_send_failed",
            correlation_id: message.correlation_id,
            error_layer: "EvolutionSendText",
          };
    }
    const parsed = parseAssistantResponseV1(rawAssistantResponse);
    if (!parsed.ok) {
      const invalidLog = {
        ...responseLogMetadata(message, deps, conversationKey),
        event_type: "ASSISTANT_RESPONSE_INVALID",
        error_code: parsed.error.code,
        error_message: parsed.error.message,
        raw_preview: parsed.error.raw_preview,
      };
      logger[parserErrorLogMethod(parsed.error.code)](invalidLog);
      const fallbackSent = await sendReply(
        message,
        ASSISTANT_SAFE_FALLBACK_REPLY,
        deps,
        latencyTracker,
      );
      recordEvent(deps, {
        message,
        state: backendContext.state,
        senderRole: backendContext.sender_role,
        assistantStatus: "completed",
        parserResult: "invalid",
        sendtextStatus: fallbackSent ? "success" : "failed",
        fallbackUsed: true,
        internalBossNoteLogged: false,
      });
      return fallbackSent
        ? { status: "fallback_sent", correlation_id: message.correlation_id }
        : {
            status: "reply_send_failed",
            correlation_id: message.correlation_id,
            error_layer: "EvolutionSendText",
          };
    }
    logger.info({
      ...responseLogMetadata(message, deps, conversationKey),
      event_type: "ASSISTANT_RESPONSE_VALID",
      assistant_response_contract_version: parsed.value.contract_version,
      reply_length: parsed.value.reply.length,
      internal_boss_note_logged: true,
    });

    const ownerPlatformUpdateNote =
      (backendContext.sender_role === "owner" || backendContext.sender_role === "manager") &&
      parsed.value.internal_boss_note?.includes("owner_platform_update_candidate") === true;
    let ownerPlatformSuggestionCreated = false;
    let ownerPlatformSuggestionDuplicate = false;
    let ownerPlatformSuggestionRef: string | undefined;
    let ownerPlatformSuggestionFailed = false;

    if (ownerPlatformUpdateNote) {
      try {
          const noteObj = JSON.parse(parsed.value.internal_boss_note);
          if (noteObj.type === "owner_platform_update_candidate" && deps.ingestionStore) {
            const suggestionId = `SUG-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
            const suggestion: LearningSuggestion = {
              suggestion_id: suggestionId,
              source_job_id: "live_owner_interaction",
              platform: "whatsapp",
              suggestion_class: "unknown",
              evidence_preview_sanitized: `App: ${noteObj.app_name || "N/A"}, Invite: ${noteObj.invite_code || "N/A"}`,
              proposed_knowledge_type: "approved_app_update",
              proposed_text: `Uygulama Adı: ${noteObj.app_name || "Bilinmiyor"}\nDavet Kodu: ${noteObj.invite_code || "Yok"}\nKurulum Şartı: ${noteObj.setup_requirement || "Belirtilmedi"}\nProfil Fotoğrafı Şartı: ${noteObj.profile_photo_required ? "Evet" : "Hayır"}\nAjans Kodu: ${noteObj.agency_code || "Yok"}`,
              confidence: 0.99,
              status: "pending_owner_review",
              created_at: new Date().toISOString(),
              source_type: "live_owner_interaction",
              source_message_safe_ref: message.message_id,
              suggested_category: "owner_platform_update"
            };
            const saveResult = deps.ingestionStore.saveLearningSuggestionIfNew(suggestion);
            ownerPlatformSuggestionCreated = saveResult.inserted;
            ownerPlatformSuggestionDuplicate = !saveResult.inserted;
            ownerPlatformSuggestionRef = saveResult.suggestion.short_ref ?? saveResult.suggestion.safe_ref ?? saveResult.suggestion.suggestion_id;
            if (saveResult.inserted) {
              logger.info({
                event_type: "OWNER_PLATFORM_UPDATE_SUGGESTION_CREATED",
                suggestion_id: suggestionId,
                suggestion_ref: ownerPlatformSuggestionRef,
                source_message_safe_ref: message.message_id,
                app_name: noteObj.app_name
              });
            } else {
              logger.info({
                event_type: "OWNER_PLATFORM_UPDATE_SUGGESTION_DUPLICATE_SKIPPED",
                suggestion_id: saveResult.suggestion.suggestion_id,
                suggestion_ref: ownerPlatformSuggestionRef,
                source_message_safe_ref: message.message_id,
                duplicate_of: saveResult.duplicate_of
              });
            }
          } else {
            ownerPlatformSuggestionFailed = true;
          }
      } catch (err) {
          ownerPlatformSuggestionFailed = true;
          logger.warn({
            event_type: "INTERNAL_BOSS_NOTE_PARSE_ERROR",
            error: err instanceof Error ? err.message : String(err)
          });
      }
    }

    const qualityGuard = applyBehaviorQualityGuard({
      reply: parsed.value.reply,
      internalBossNote: parsed.value.internal_boss_note,
      context: modelBackendContext,
      deps,
      conversationKey,
      correlationId: message.correlation_id,
    });
    const publicReply = ownerPlatformSuggestionCreated
      ? ownerPlatformUpdateQueuedReply(ownerPlatformSuggestionRef)
      : ownerPlatformSuggestionDuplicate
        ? ownerPlatformUpdateAlreadyQueuedReply(ownerPlatformSuggestionRef)
      : ownerPlatformSuggestionFailed
        ? OWNER_PLATFORM_UPDATE_QUEUE_FAILED_REPLY
        : qualityGuard.reply;
    const addressedReply = sanitizePrivilegedReplyAddress(publicReply, backendContext.sender_role);
    const guard = checkApprovedAppGate(addressedReply, backendContext);

    const replyText = guard.ok
      ? addressedReply
      : SAFE_APPROVED_APP_GATE_REPLY;
    if (!guard.ok) {
      logger.warn({
        event_type: "UNAPPROVED_APP_SUGGESTION",
        correlation_id: message.correlation_id,
        sender_role: backendContext.sender_role,
        chat_type: backendContext.chat_type,
        message_id: message.message_id,
        term_count: guard.term_count,
      });
    }
    const replySent = await sendReply(message, replyText, deps, latencyTracker);
    if (!replySent) {
      recordEvent(deps, {
        message,
        state: backendContext.state,
        senderRole: backendContext.sender_role,
        assistantStatus: "completed",
        parserResult: guard.ok ? "valid" : "valid_guarded",
        sendtextStatus: "failed",
        fallbackUsed: !guard.ok || qualityGuard.fallbackUsed,
        internalBossNoteLogged: true,
      });
      return {
        status: "reply_send_failed",
        correlation_id: message.correlation_id,
        error_layer: "EvolutionSendText",
      };
    }
    deps.memoryStore.appendBotReply(conversationKey, replyText);
    recordEvent(deps, {
      message,
      state: backendContext.state,
      senderRole: backendContext.sender_role,
      assistantStatus: "completed",
      parserResult: guard.ok ? "valid" : "valid_guarded",
      sendtextStatus: "success",
      fallbackUsed: !guard.ok || qualityGuard.fallbackUsed,
      internalBossNoteLogged: true,
    });
    return { status: qualityGuard.status, correlation_id: message.correlation_id };
  });
  return latencyTracker.finish(lockedResult);
}
async function sendReply(
  message: NormalizedIncomingMessage,
  text: string,
  deps: HandleIncomingMessageDeps,
  latencyTracker?: RequestLatencyTracker,
): Promise<boolean> {
  try {
    latencyTracker?.markSendStart();
    if (isOutboundShadowEnabled(deps.env.outboundQueueMode)) {
      enqueueOutboundShadow({
        store: deps.reliabilityQueueStore,
        message,
        text,
        logger: deps.logger,
      });
    }
    await deps.sender.sendText({ message, text });
    deps.connectionHealthMonitor?.recordSendConfirmed({
      correlation_id: message.correlation_id,
        message_id: message.message_id,
    });
    latencyTracker?.markSendConfirmed();
    deps.logger.info({
      event_type: "WHATSAPP_SEND_SUCCESS",
      correlation_id: message.correlation_id,
      message_id: message.message_id,
    });
    return true;
  } catch (error) {
    const httpStatus =
      error instanceof EvolutionSendTextError ? error.httpStatus : undefined;
    deps.logger.error({
      event_type: "SEND_TEXT_FAILED",
      correlation_id: message.correlation_id,
      message_id: message.message_id,
      masked_phone: maskPhone(message.phone_number),
      instance: deps.env.evolutionInstance,
      http_status: httpStatus ?? "unknown",
      error_layer: "EvolutionSendText",
      error: redactSecrets(
        error instanceof Error ? error.message : String(error),
      ),
    });
    return false;
  }
}
