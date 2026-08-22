import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { loadEnv } from "./config/env.js";
import { OpenAIAssistantClient } from "./assistant/openaiAssistantClient.js";
import { registerEvolutionWebhook } from "./bridge/evolutionWebhook.js";
import { EvolutionApiSender } from "./bridge/sendTextMessage.js";
import { logger } from "./observability/logger.js";
import { UserRunLock } from "./queue/userRunLock.js";
import { createPersistentJsonStore } from "./storage/persistentJsonStore.js";
import { PersistentIngestionStore } from "./storage/ingestionStore.js";
import { PersistentMaintenanceStore } from "./store/maintenanceStore.js";
import { registerDashboardRoutes } from "./bridge/dashboardRoutes.js";
import { PersistentActionAuditStore } from "./store/actionAuditStore.js";
import { validateProductionEnv } from "./config/envValidator.js";
import { PersistentSocialLeadStore } from "./store/socialLeadStore.js";
import { FileWhatsAppLearningStore } from "./store/whatsappLearningStore.js";
import { FileWhatsAppVisualResearchStore } from "./store/whatsappVisualResearchStore.js";
import { ModelExecutionService, type ModelExecutionRuntimeSnapshot } from "./modelAdapter/modelExecutionService.js";
import { createOpenAIResponsesAdapter } from "./modelAdapter/ResponsesAdapter.js";
import { createOpenAIOwnerNaturalLanguageIntentClassifier } from "./bridge/ownerNaturalLanguageIntent.js";
import { ResponsesShadowService, type ResponsesShadowSnapshot } from "./modelAdapter/responsesShadowService.js";
import { ConnectionHealthMonitor } from "./observability/connectionHealthMonitor.js";
import { SmtpConnectionAlarmNotifier } from "./observability/connectionAlarmNotifier.js";
import { resolve } from "node:path";
import { ModelAdapterCanaryApprovalStore } from "./modelAdapter/modelAdapterCanaryApproval.js";
import { ModelAdapterCanaryApprovalAuditStore } from "./modelAdapter/modelAdapterCanaryApprovalAudit.js";
import { ModelAdapterCanaryApprovalController } from "./modelAdapter/modelAdapterCanaryApprovalController.js";
import { ModelAdapterCanaryStateStore } from "./modelAdapter/modelAdapterCanaryStateStore.js";
import { ModelAdapterCanaryThresholdEvaluator } from "./modelAdapter/modelAdapterCanaryThresholds.js";
import { ModelAdapterCanaryControl } from "./modelAdapter/modelAdapterCanaryControl.js";
import { PersistentReliabilityQueueStore } from "./reliability/persistentReliabilityQueueStore.js";
import { DeliveryEventLedger } from "./reliability/deliveryEventLedger.js";
import { ReliableEvolutionSender } from "./reliability/reliableEvolutionSender.js";
import { ReliabilityQueueWorker, processOutboundJob } from "./reliability/queueWorker.js";
import { queueBacklogSnapshot, emitQueueInfraAlerts } from "./reliability/queueMonitoring.js";
import { SmtpOperationalAlarmNotifier } from "./observability/operationalAlarmNotifier.js";
import { PersistentHumanHandoffStore } from "./store/humanHandoffStore.js";
import { PersistentTrainingHandoffStore } from "./store/trainingHandoffStore.js";
import { createOpenAIInstallationVisionClassifier } from "./bridge/openaiInstallationVisionClassifier.js";
import { createEvolutionSessionIntegrityCheck } from "./observability/evolutionSessionIntegrity.js";
import { ZipIngestionStore } from "./bridge/zipIngestion/store.js";
import { registerReviewRoutes } from "./bridge/reviewRoutes.js";
import { validateKnowledgeAtStartup } from "./bridge/knowledgeStartupGuard.js";
import { InstallationVerificationReviewStore } from "./store/installationVerificationReviewStore.js";
import { OwnerHandoffDeadlineWorker } from "./bridge/ownerHandoffDeadlineWorker.js";
import {
  assertSingleProductionModelResponseContract,
  CANONICAL_MODEL_RESPONSE_CONTRACT,
} from "./modelAdapter/modelResponseContractGuard.js";

const DEFAULT_RESPONSES_SHADOW_SNAPSHOT: ResponsesShadowSnapshot = {
  enabled: false,
  mode: "off",
  default_off: true,
  primary_path_unchanged: true,
  outbound_allowed: false,
  state_writes_allowed: false,
  last_status: "never_run",
  last_reason: "disabled_global",
  last_observed_at: null,
  last_schema_valid: null,
  last_semantic_valid: null,
  last_transition_prep_valid: null,
  last_role_match: null,
  last_reply_present: null,
  last_latency_ms: null,
  observations_total: 0,
  valid_total: 0,
  invalid_total: 0,
  provider_error_total: 0,
  timeout_total: 0,
};

export function registerConnectionDoctorRoute(
  app: any,
  monitor: { snapshot: () => unknown },
  flags: {
    behaviorOrchestratorEnabled?: boolean;
    responsesShadowSnapshot?: () => ResponsesShadowSnapshot;
    modelAdapterSnapshot?: () => ModelExecutionRuntimeSnapshot;
  } = {},
) {
  app.get("/healthz/connection-doctor", async (_req: unknown, reply: any) => {
    const behaviorEnabled = flags.behaviorOrchestratorEnabled === true;
    const modelAdapterStatus = flags.modelAdapterSnapshot?.();
    reply.send({
      status: "ok",
      service: "now-os",
      connection: monitor.snapshot(),
      behavior: {
        behavior_orchestrator_enabled_default: false,
        behavior_orchestrator_enabled: behaviorEnabled,
        behavior_orchestrator_global_enabled: behaviorEnabled,
        behavior_canary_mode: "off",
        behavior_tenant_canary_enabled: false,
        behavior_tenant_allowlist_configured: false,
        behavior_internal_scope_configured: false,
        behavior_default_deny: true,
        behavior_production_global_active: false,
        behavior_canary_scope_supported: true,
        behavior_last_objective: "not_tracked",
        behavior_last_stage_transition_status: "not_tracked",
        behavior_recent_context_budget_applied: false,
        behavior_golden_score_latest: 0.95,
        behavior_quality_contract_version: "1.0",
        behavior_quality_contract_available: true,
        behavior_golden_suite_available: true,
        behavior_repetition_control_available: true,
        behavior_context_continuity_available: true,
        behavior_escalation_policy_available: true,
        behavior_production_enabled: behaviorEnabled,
        behavior_canary_observability_available: true,
        behavior_canary_correlation_available: true,
        behavior_canary_rollback_ready: true,
        behavior_last_terminal_outcome_available: true,
        behavior_sensitive_content_exposed: false,
        rollback_mode: "flag_off",
        production_canary_ready: false,
      },
      model_adapter: modelAdapterStatus ?? {
        model_adapter_layer_global_enabled: false,
        model_adapter_canary_mode: "off",
        model_adapter_canary_mode_configured: "off",
        model_adapter_canary_scope_supported: true,
        model_adapter_current_decision: { use_adapter_layer: false, reason: "disabled_mode_off", canary_scope: "off" },
        model_adapter_selected_adapter: "assistant_adapter",
        model_adapter_provider: "openai_assistant",
        model_adapter_last_success_at: null,
        model_adapter_last_error_class: "none",
        model_execution_last_error_code: "none",
        model_execution_timeout_supported: true,
        model_execution_timeout_enabled: false,
        model_execution_timeout_ms_configured: false,
        model_execution_cancellation_supported: true,
        model_execution_error_normalization: true,
        adapter_abort_propagation_supported: false,
        late_result_ignored: false,
        model_adapter_rollback_method: "FLAG_OFF",
        assistant_id_changed: false,
        provider_changed: false,
        responses_api_used: false,
        automatic_stop_code_active: false,
        canary_stop_latched: false,
        canary_stop_reason: null,
        canary_approval_valid: false,
        canary_reservation_count: 0,
        canary_terminal_observation_count: 0,
        canary_terminal_window_target: 20,
        canary_terminal_window_progress: 0,
        canary_terminal_window_complete: false,
        canary_window_started_at: null,
        canary_last_terminal_at: null,
        canary_result_totals: {
          unsafe_claim_count: 0,
          safe_fallback_count: 0,
          validator_reject_count: 0,
          schema_or_parse_reject_count: 0,
          final_provider_failure_count: 0,
          model_origin_accepted_count: 0,
        },
      },
      model_adapter_contract: {
        model_adapter_contract_version: CANONICAL_MODEL_RESPONSE_CONTRACT,
        model_adapter_contract_tests_available: true,
        active_adapter_name: modelAdapterStatus?.model_adapter_selected_adapter ?? "assistant_adapter",
        adapter_layer_enabled: modelAdapterStatus?.model_adapter_layer_global_enabled ?? false,
        adapter_canary_mode: modelAdapterStatus?.model_adapter_canary_mode ?? "off",
        provider_specific_details_exposed: false,
      },
      model_execution_resilience: {
        model_execution_timeout_supported: true,
        model_execution_timeout_enabled: false,
        model_execution_timeout_ms_configured: false,
        model_execution_cancellation_supported: true,
        model_execution_error_normalization: true,
        adapter_abort_propagation_supported: false,
        late_result_ignored: false,
        raw_timeout_value_exposed: false,
        provider_details_exposed: false,
      },
      adapter_canary: {
        live_owner_canary_status: "OWNER_SKIPPED",
        synthetic_adapter_canary_status: "REPLAY_HARNESS_AVAILABLE",
        adapter_global_default: modelAdapterStatus?.model_adapter_layer_global_enabled ?? false,
        ready_for_adapter_default_on: modelAdapterStatus?.model_adapter_layer_global_enabled === true
          && modelAdapterStatus.model_adapter_selected_adapter === "responses_adapter",
        ready_for_responses_adapter_design: true,
        rollback_method: "FLAG_OFF",
      },
      responses_shadow: flags.responsesShadowSnapshot?.() ?? DEFAULT_RESPONSES_SHADOW_SNAPSHOT,
      safety: {
        provider_changed: modelAdapterStatus?.provider_changed ?? false,
        assistant_id_changed: false,
        contract_version: CANONICAL_MODEL_RESPONSE_CONTRACT,
        public_reply_only: true,
        raw_text_logged: false,
        full_prompt_logged: false,
        responses_api_used: modelAdapterStatus?.responses_api_used ?? false,
      },
    });
  });
}

export function isRuntimeLockConflict(
  oldPid: number,
  currentPid: number,
  isProcessAlive: (pid: number) => boolean = (pid) => {
    try {
      process.kill(pid, 0);
      return true
    } catch (error: any) {
      return error?.code === "EPERM"
    }
  }
): boolean {
  // In a container, PID 1 is the current process. A persisted PID 1 lock
  // from a previous container lifetime is stale, not a live second process.
  return oldPid !== currentPid && isProcessAlive(oldPid)
}

export async function buildServer() {
  const env = loadEnv();
  validateProductionEnv(env);
  assertSingleProductionModelResponseContract(env);

  if (process.env.NODE_ENV !== "test") {
    const knowledgeValidation = validateKnowledgeAtStartup();
    if (!knowledgeValidation.valid) {
      logger.error({
        event_type: "KNOWLEDGE_STARTUP_SYNC_FAILED",
        structured_status: knowledgeValidation.structured_status,
        manifest_status: knowledgeValidation.manifest_status,
        approved_app_count: knowledgeValidation.approved_app_count,
        routing_targets_valid: knowledgeValidation.routing_targets_valid,
        age_policy_valid: knowledgeValidation.age_policy_valid,
        payment_policy_valid: knowledgeValidation.payment_policy_valid,
        runtime_source_present: knowledgeValidation.runtime_source_present,
        runtime_source_readable: knowledgeValidation.runtime_source_readable,
        runtime_backup_present: knowledgeValidation.runtime_backup_present,
        runtime_manifest_hash_valid: knowledgeValidation.runtime_manifest_hash_valid,
        stage_policy_presence: knowledgeValidation.stage_policy_presence,
        stage_policy_warning_codes: knowledgeValidation.stage_policy_warning_codes,
        training_knowledge_valid: knowledgeValidation.training_knowledge_valid,
        training_candidate_context_isolated: knowledgeValidation.training_candidate_context_isolated,
        training_section_count: knowledgeValidation.training_section_count,
        error_count: knowledgeValidation.error_codes.length,
      });
      throw new Error("Knowledge startup validation failed");
    }
    logger.info({
      event_type: "KNOWLEDGE_STARTUP_SYNC_VALID",
      structured_status: knowledgeValidation.structured_status,
      manifest_status: knowledgeValidation.manifest_status,
      approved_app_count: knowledgeValidation.approved_app_count,
      routing_targets_valid: knowledgeValidation.routing_targets_valid,
      age_policy_valid: knowledgeValidation.age_policy_valid,
      payment_policy_valid: knowledgeValidation.payment_policy_valid,
      runtime_source_present: knowledgeValidation.runtime_source_present,
      runtime_source_readable: knowledgeValidation.runtime_source_readable,
      runtime_backup_present: knowledgeValidation.runtime_backup_present,
      runtime_backup_age_seconds: knowledgeValidation.runtime_backup_age_seconds,
      runtime_manifest_hash_valid: knowledgeValidation.runtime_manifest_hash_valid,
      stage_policy_presence: knowledgeValidation.stage_policy_presence,
      stage_policy_warning_codes: knowledgeValidation.stage_policy_warning_codes,
      training_knowledge_valid: knowledgeValidation.training_knowledge_valid,
      training_candidate_context_isolated: knowledgeValidation.training_candidate_context_isolated,
      training_section_count: knowledgeValidation.training_section_count,
      fallback_policy_warning_count: knowledgeValidation.fallback_policy_warning_codes.length,
    });
    if (knowledgeValidation.stage_policy_warning_codes.length > 0) {
      logger.warn({
        event_type: "KNOWLEDGE_STARTUP_STAGE_POLICY_WARNING",
        warning_codes: knowledgeValidation.stage_policy_warning_codes,
      });
    }
    if (knowledgeValidation.fallback_policy_warning_codes.length > 0) {
      logger.warn({
        event_type: "KNOWLEDGE_STARTUP_FALLBACK_POLICY_WARNING",
        warning_codes: knowledgeValidation.fallback_policy_warning_codes,
      });
    }
  }

  const app = Fastify({ logger: false });
  const DATA_DIR = resolve("data");

  // Single Instance Guard
  const LOCK_FILE = resolve(DATA_DIR, "runtime.lock");
  const fs = await import("node:fs");
  if (fs.existsSync(LOCK_FILE)) {
    const oldPid = parseInt(fs.readFileSync(LOCK_FILE, "utf8"), 10);
    if (!isNaN(oldPid)) {
      const isRunning = isRuntimeLockConflict(oldPid, process.pid);
      if (isRunning) {
        logger.error({ event_type: "SINGLE_INSTANCE_GUARD_FAILED", message: `Another instance is running with PID ${oldPid} on ${DATA_DIR}` });
        throw new Error(`Single Instance Guard: Another process (PID: ${oldPid}) is already running on this data directory.`);
      }
    }
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LOCK_FILE, process.pid.toString(), "utf8");

  const persistentStore = createPersistentJsonStore();
  const ingestionStore = new PersistentIngestionStore(DATA_DIR);
  const zipIngestionStore = new ZipIngestionStore(resolve(DATA_DIR, "zip_ingestion", "store.json"));
  const maintenanceStore = new PersistentMaintenanceStore(resolve(DATA_DIR, "maintenance.json"));
  const actionAuditStore = new PersistentActionAuditStore(resolve(DATA_DIR, "audit_log.json"));
  const socialLeadStore = new PersistentSocialLeadStore(resolve(DATA_DIR, "social_leads.json"));
  const whatsappLearningStore = new FileWhatsAppLearningStore(resolve(DATA_DIR, "whatsapp_learning_messages.json"));
  const whatsappVisualResearchStore = new FileWhatsAppVisualResearchStore(resolve(DATA_DIR, "whatsapp_visual_research.json"));
  const assistantClient = new OpenAIAssistantClient(env.openaiApiKey, env.openaiAssistantId);
  const modelAdapterCanaryApprovalStore = new ModelAdapterCanaryApprovalStore(
    resolve(DATA_DIR, "model_adapter_canary_approval.json"),
  );
  const modelAdapterCanaryApprovalController = new ModelAdapterCanaryApprovalController(
    modelAdapterCanaryApprovalStore,
    new ModelAdapterCanaryApprovalAuditStore(resolve(DATA_DIR, "model_adapter_canary_approval_audit.ndjson")),
    env,
  );
  const modelAdapterCanaryControl = new ModelAdapterCanaryControl(
    modelAdapterCanaryApprovalStore,
    new ModelAdapterCanaryThresholdEvaluator(),
    logger,
    undefined,
    new ModelAdapterCanaryStateStore(resolve(DATA_DIR, "model_adapter_canary_state.json")),
  );
  let responsesShadowService: ResponsesShadowService | undefined;
  const responsesCanaryConfigured = env.modelAdapterCanaryMode !== "off"
    && env.modelAdapterCanaryIntents.length > 0;
  const responsesRuntimeNeeded = env.modelAdapterLayerEnabled
    || (env.responsesShadowEnabled && env.responsesShadowMode !== "off")
    || responsesCanaryConfigured;
  const responsesAdapter = responsesRuntimeNeeded && env.openaiResponsesModel
    ? await createOpenAIResponsesAdapter({
      apiKey: env.openaiApiKey,
      model: env.openaiResponsesModel,
    })
    : undefined;
  const ownerNaturalLanguageIntentClassifier = env.openaiResponsesModel
    ? await createOpenAIOwnerNaturalLanguageIntentClassifier({
      apiKey: env.openaiApiKey,
      model: env.openaiResponsesModel,
    })
    : undefined;
  if (env.responsesShadowEnabled && env.responsesShadowMode !== "off" && responsesAdapter) {
    responsesShadowService = new ResponsesShadowService(
      responsesAdapter,
      {
        enabled: true,
        mode: env.responsesShadowMode,
        tenants: env.responsesShadowTenants,
        roles: env.responsesShadowRoles,
        timeoutMs: env.responsesShadowTimeoutMs,
      },
      logger,
    );
  } else if (env.responsesShadowEnabled) {
    logger.warn({
      event_type: "RESPONSES_SHADOW_NOT_ARMED",
      reason: env.responsesShadowMode === "off" ? "mode_off" : "model_not_configured",
      raw_text_logged: false,
    });
  }
  if (responsesCanaryConfigured && !responsesAdapter) {
    logger.error({
      event_type: "MODEL_ADAPTER_CANARY_NOT_ARMED",
      reason: "responses_model_not_configured",
      effective_canary_mode: "off",
      raw_text_logged: false,
    });
  }
  const modelExecutionService = new ModelExecutionService(
    assistantClient,
    persistentStore.threadStore,
    {
      modelAdapterLayerEnabled: env.modelAdapterLayerEnabled,
      modelAdapterCanaryMode: env.modelAdapterCanaryMode,
      modelExecutionTimeoutEnabled: env.modelExecutionTimeoutEnabled,
      modelExecutionTimeoutMsConfigured: env.modelExecutionTimeoutMs > 0,
      responsesShadowObserver: responsesShadowService,
      canaryControl: modelAdapterCanaryControl,
      canaryAdapter: responsesAdapter,
      logger,
    },
  );
  const humanHandoffStore = new PersistentHumanHandoffStore(resolve(DATA_DIR, "human-handoffs.json"));
  const installationVerificationReviewStore = new InstallationVerificationReviewStore(resolve(DATA_DIR, "installation-verification-reviews.json"));
  const sessionIntegrityCheck = createEvolutionSessionIntegrityCheck({
    databaseUrl: env.evolutionSessionDatabaseUrl,
    instanceName: env.evolutionInstance,
    logger,
  });
  const connectionAlarmNotifier = new SmtpConnectionAlarmNotifier({
    enabled: env.smtpAlertEnabled === true,
    host: env.smtpHost,
    port: env.smtpPort ?? 587,
    secure: env.smtpSecure === true,
    username: env.smtpUsername,
    password: env.smtpPassword,
    from: env.smtpFrom,
    recipients: env.smtpAlertRecipients ?? [],
    logger,
  });
  logger[connectionAlarmNotifier.isConfigured() ? "info" : "warn"]({
    event_type: connectionAlarmNotifier.isConfigured()
      ? "EVOLUTION_SMTP_ALARM_CHANNEL_READY"
      : "EVOLUTION_SMTP_ALARM_CHANNEL_NOT_CONFIGURED",
    configured: connectionAlarmNotifier.isConfigured(),
  });
  const reliabilityQueueStore = new PersistentReliabilityQueueStore(resolve(DATA_DIR, "reliability", "outbox.json"));
  const deliveryEventLedger = new DeliveryEventLedger(resolve(DATA_DIR, "reliability", "delivery-events.json"));
  const operationalAlarmNotifier = new SmtpOperationalAlarmNotifier({
    enabled: env.smtpAlertEnabled === true,
    host: env.smtpHost,
    port: env.smtpPort ?? 587,
    secure: env.smtpSecure === true,
    username: env.smtpUsername,
    password: env.smtpPassword,
    from: env.smtpFrom,
    recipients: env.smtpAlertRecipients ?? [],
    logger,
  });
  const connectionHealthMonitor = new ConnectionHealthMonitor({
    evolutionInstance: env.evolutionInstance,
    evolutionApiBaseUrl: env.evolutionApiBaseUrl,
    evolutionApiKey: env.evolutionApiKey,
    logger,
    autoReconnectEnabled: env.evolutionAutoReconnectEnabled,
    reconnectBaseDelayMs: env.evolutionReconnectBaseDelayMs,
    reconnectCooldownMs: env.evolutionReconnectCooldownMs,
    connectingTimeoutMs: env.evolutionConnectingTimeoutMs,
    refusedRetryDelayMs: env.evolutionRefusedRetryDelayMs,
    stableOpenResetMs: env.evolutionStableOpenResetMs,
    inboundUpdateGraceMs: env.evolutionInboundUpdateGraceMs,
    inboundDeafRetryDelayMs: env.evolutionInboundDeafRetryDelayMs,
    connectionControlStatePath: resolve(DATA_DIR, "evolution-connection-control.json"),
    logoutEventsPath: resolve(DATA_DIR, "evolution-logout-events.json"),
    sessionIntegrityCheck,
    alarmNotifier: connectionAlarmNotifier,
    queueSnapshotProvider: () => queueBacklogSnapshot(reliabilityQueueStore, {
      workersEnabled: env.reliableOutboxEnabled,
      inboundShadowOnly: env.webhookQueueMode === "dual_write",
    }),
    onLogout401: ({ instance }) => {
      const result = humanHandoffStore.create({
        tenant_id: "now_os",
        reason_code: "evolution_session_logout_401",
        urgency: "high",
        conversation_key_hash: `evolution:${instance}`,
        source_correlation_id: "evolution-session-monitor",
      });
      logger.warn({
        event_type: result.created ? "EVOLUTION_LOGOUT_HANDOFF_RECORDED" : "EVOLUTION_LOGOUT_HANDOFF_ALREADY_PRESENT",
        reason_code: "evolution_session_logout_401",
        created: result.created,
      });
    },
    onConnectionAlarm: ({ kind, instance }) => {
      if (kind === "logged_out_401") return;
      if (kind === "connection_recovered") {
        logger.info({ event_type: "EVOLUTION_CONNECTION_RECOVERY_AUDIT", evolution_instance: instance });
        return;
      }
      const result = humanHandoffStore.create({
        tenant_id: "now_os",
        reason_code: `evolution_connection_${kind}`,
        urgency: "high",
        conversation_key_hash: `evolution:${instance}`,
        source_correlation_id: "evolution-connection-monitor",
      });
      logger.warn({
        event_type: result.created ? "EVOLUTION_CONNECTION_HANDOFF_RECORDED" : "EVOLUTION_CONNECTION_HANDOFF_ALREADY_PRESENT",
        reason_code: `evolution_connection_${kind}`,
        created: result.created,
      });
    },
    modeSnapshotProvider: () => ({
      inbound_queue_mode: env.webhookQueueMode,
      outbound_queue_mode: env.outboundQueueMode,
      fast_ack_enabled: env.fastAckEnabled,
      workers_enabled: env.workersEnabled || env.reliableOutboxEnabled === true,
      behavior_tenant_canary_available: true,
      behavior_tenant_canary_enabled: env.behaviorTenantCanaryEnabled,
      behavior_tenant_canary_allowed_tenant_count: env.behaviorCanaryTenants.length,
    }),
  });
  registerConnectionDoctorRoute(app, connectionHealthMonitor, {
    behaviorOrchestratorEnabled: env.behaviorOrchestratorEnabled,
    responsesShadowSnapshot: responsesShadowService
      ? () => responsesShadowService.snapshot()
      : () => ({
          ...DEFAULT_RESPONSES_SHADOW_SNAPSHOT,
          enabled: env.responsesShadowEnabled,
          mode: env.responsesShadowMode,
          last_reason: env.responsesShadowEnabled
            ? (env.responsesShadowMode === "off" ? "disabled_mode_off" : "model_not_configured")
            : "disabled_global",
        }),
    modelAdapterSnapshot: () => modelExecutionService.snapshot(),
  });
  await connectionHealthMonitor.runReachabilityCheck("startup");
  const reachabilityInterval = setInterval(() => {
    connectionHealthMonitor.runReachabilityCheck("periodic").catch((error) => {
      logger.warn({ event_type: "GATEWAY_REACHABILITY_CHECK_FAILED", error: String(error) });
    });
  }, 60_000);
  reachabilityInterval.unref?.();
  await app.register(cors);
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit

  app.get("/healthz", async (req, reply) => {
    reply.send({
      status: "ok",
      service: "now-os",
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  app.get("/readyz", async (req, reply) => {
    // Basic public readiness
    const isReady = env.openaiApiKey && env.evolutionApiBaseUrl;
    reply.code(isReady ? 200 : 503).send({
      status: isReady ? "ready" : "not_ready",
      port: env.port,
      runtime: `Node.js ${process.version}`,
      timestamp: new Date().toISOString()
    });
  });

  const rawEvolutionSender = new EvolutionApiSender(env);
  const evolutionSender = env.reliableOutboxEnabled
    ? new ReliableEvolutionSender({
        rawSender: rawEvolutionSender,
        store: reliabilityQueueStore,
        ledger: deliveryEventLedger,
        logger,
        maxAttempts: env.reliableOutboxMaxAttempts,
      })
    : rawEvolutionSender;
  const ownerHandoffDeadlineWorker = new OwnerHandoffDeadlineWorker({
    store: humanHandoffStore,
    sender: evolutionSender,
    teamPhoneNumbers: env.teamEscalationPhoneNumbers,
    logger,
  });
  await ownerHandoffDeadlineWorker.runOnce();
  let ownerHandoffWorkerBusy = false;
  const ownerHandoffInterval = setInterval(async () => {
    if (ownerHandoffWorkerBusy) return;
    ownerHandoffWorkerBusy = true;
    try {
      await ownerHandoffDeadlineWorker.runOnce();
    } catch (error) {
      logger.warn({
        event_type: "OWNER_HANDOFF_DEADLINE_WORKER_FAILED",
        error: error instanceof Error ? error.message : String(error),
        raw_text_logged: false,
      });
    } finally {
      ownerHandoffWorkerBusy = false;
    }
  }, 30_000);
  ownerHandoffInterval.unref?.();
  const outboundWorker = new ReliabilityQueueWorker({
    queueName: "outbound",
    workerId: `outbound-${process.pid}`,
    store: reliabilityQueueStore,
    logger,
    connectionHealthMonitor,
    onJobStatus: (job, status) => {
      const message = job.payload.message as { correlation_id?: unknown } | undefined;
      const correlationId = typeof message?.correlation_id === "string" ? message.correlation_id : "outbound-worker";
      deliveryEventLedger.append({
        event_type: status === "COMPLETED" ? "outbound_delivered" : status === "DEAD_LETTER" ? "outbound_dead_letter" : "outbound_retry_scheduled",
        correlation_id: correlationId,
        job_id: job.job_id,
        status,
        metadata: { attempt_count: job.attempt_count },
      });
    },
  });
  if (env.reliableOutboxEnabled) await outboundWorker.start();
  let previousOutboxAlarm = false;
  let workerBusy = false;
  const outboxInterval = setInterval(async () => {
    if (!env.reliableOutboxEnabled || workerBusy) return;
    workerBusy = true;
    try {
      for (let index = 0; index < 20; index += 1) {
        const result = await outboundWorker.runOnce((job) => processOutboundJob(job, rawEvolutionSender, connectionHealthMonitor));
        if (!result.picked) break;
      }
      const snapshot = queueBacklogSnapshot(reliabilityQueueStore, {
        workersEnabled: true,
        inboundShadowOnly: env.webhookQueueMode === "dual_write",
      });
      emitQueueInfraAlerts(snapshot, logger);
      const alarm = snapshot.backlog_alarm || snapshot.dead_letter_alarm;
      if (alarm && !previousOutboxAlarm) {
        await operationalAlarmNotifier.send({
          kind: snapshot.dead_letter_alarm ? "outbound_dead_letter" : "outbox_backlog",
          pending: snapshot.outbound_queue_pending,
          dead_letters: snapshot.dead_letter_count,
          occurred_at: new Date().toISOString(),
        });
      } else if (!alarm && previousOutboxAlarm) {
        await operationalAlarmNotifier.send({
          kind: "outbox_recovered",
          pending: snapshot.outbound_queue_pending,
          dead_letters: snapshot.dead_letter_count,
          occurred_at: new Date().toISOString(),
        });
      }
      previousOutboxAlarm = alarm;
    } finally {
      workerBusy = false;
    }
  }, env.reliableOutboxPollMs ?? 5_000);
  outboxInterval.unref?.();
  app.addHook("onClose", async () => {
    clearInterval(outboxInterval);
    clearInterval(reachabilityInterval);
    clearInterval(ownerHandoffInterval);
  });
  logger.info({
    event_type: "RELIABLE_OUTBOX_RUNTIME",
    enabled: env.reliableOutboxEnabled,
    pending: reliabilityQueueStore.counts().outbound_queue_pending,
    dead_letters: reliabilityQueueStore.counts().dead_letter_count,
  });
  const trainingHandoffStore = new PersistentTrainingHandoffStore(resolve(DATA_DIR, "training-handoffs.json"));
  const installationVerificationClassifier = env.installationVisionEnabled && env.openaiResponsesModel
    ? await createOpenAIInstallationVisionClassifier({
        apiKey: env.openaiApiKey,
        model: env.openaiResponsesModel,
      })
    : undefined;
  if (env.modelAdapterLayerEnabled && !responsesAdapter) {
    logger.error({
      event_type: "MODEL_ADAPTER_GLOBAL_RUNTIME_NOT_ARMED",
      reason: "responses_model_not_configured",
      raw_text_logged: false,
    });
    throw new Error("MODEL_ADAPTER_LAYER_ENABLED requires a configured Responses adapter");
  }

  registerEvolutionWebhook(app, {
    env,
    assistantClient,
    modelExecutionService,
    ownerNaturalLanguageIntentClassifier,
    sender: evolutionSender,
    reliabilityQueueStore,
    deliveryEventLedger,
    threadStore: persistentStore.threadStore,
    memoryStore: persistentStore.memoryStore,
    messageDedupeStore: persistentStore.messageDedupeStore,
    userStateStore: persistentStore.userStateStore,
    eventLogStore: persistentStore.eventLogStore,
    queueStore: persistentStore.queueStore,
    reportDataSource: {
      ...persistentStore.reportDataSource,
      listCandidateStates: () => persistentStore.reportDataSource.listCandidateStates(),
      listQueueItems: () => persistentStore.reportDataSource.listQueueItems(),
      getQueueSummary: () => persistentStore.reportDataSource.getQueueSummary(),
      listPublishers: () => persistentStore.reportDataSource.listPublishers(),
      listRecentInboundActivity: (since: string) => persistentStore.reportDataSource.listRecentInboundActivity?.(since) ?? [],
      listLearningSuggestions: () => ingestionStore.listLearningSuggestions()
    },
    ingestionStore,
    zipIngestionStore,
    publisherStore: persistentStore.publisherStore,
    dailyReportStore: persistentStore.dailyReportStore,
    maintenanceStore,
    humanHandoffStore,
    installationVerificationReviewStore,
    installationVerificationClassifier,
    actionAuditStore,
    knowledgeBankDir: resolve(DATA_DIR, "knowledge_bank"),
    userRunLock: new UserRunLock(),
    logger,
    connectionHealthMonitor
  });

  registerDashboardRoutes(app, {
    env,
    reportDataSource: persistentStore.reportDataSource,
    maintenanceStore,
    queueStore: persistentStore.queueStore,
    actionAuditStore,
    ingestionStore,
    socialLeadStore,
    whatsappLearningStore,
    whatsappVisualResearchStore,
    modelAdapterCanaryApprovalController,
    humanHandoffStore,
    trainingHandoffStore,
    connectionHealthMonitor,
  });

  registerReviewRoutes(app, {
    env,
    zipIngestionStore,
    actionAuditStore,
    knowledgeBankDir: resolve(DATA_DIR, "knowledge_bank"),
  });

  return { app, env };
}

if (process.env.NODE_ENV !== "test") {
  const { app, env } = await buildServer();
  await app.listen({ port: env.port, host: "0.0.0.0" });
  logger.info({ event_type: "SERVER_STARTED", port: env.port });

  const signals = ["SIGINT", "SIGTERM"];
  for (const signal of signals) {
    process.on(signal, async () => {
      logger.info({ event_type: "SERVER_SHUTTING_DOWN", signal });
      try {
        await app.close();
        const fs = await import("node:fs");
        const LOCK_FILE = resolve("data", "runtime.lock");
        if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
        logger.info({ event_type: "SERVER_SHUTDOWN_COMPLETE" });
        process.exit(0);
      } catch (err) {
        logger.error({ event_type: "SERVER_SHUTDOWN_ERROR", error: String(err) });
        process.exit(1);
      }
    });
  }
}
