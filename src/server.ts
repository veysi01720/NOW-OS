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
import { ModelExecutionService } from "./modelAdapter/modelExecutionService.js";
import { createOpenAIResponsesAdapter } from "./modelAdapter/ResponsesAdapter.js";
import { ResponsesShadowService, type ResponsesShadowSnapshot } from "./modelAdapter/responsesShadowService.js";
import { ConnectionHealthMonitor } from "./observability/connectionHealthMonitor.js";
import { resolve } from "node:path";

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
  } = {},
) {
  app.get("/healthz/connection-doctor", async (_req: unknown, reply: any) => {
    const behaviorEnabled = flags.behaviorOrchestratorEnabled === true;
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
      model_adapter: {
        model_adapter_layer_global_enabled: false,
        model_adapter_canary_mode: "off",
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
      },
      model_adapter_contract: {
        model_adapter_contract_version: "1.0",
        model_adapter_contract_tests_available: true,
        active_adapter_name: "assistant_adapter",
        adapter_layer_enabled: false,
        adapter_canary_mode: "off",
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
        adapter_global_default: false,
        ready_for_adapter_default_on: false,
        ready_for_responses_adapter_design: true,
        rollback_method: "FLAG_OFF",
      },
      responses_shadow: flags.responsesShadowSnapshot?.() ?? DEFAULT_RESPONSES_SHADOW_SNAPSHOT,
      safety: {
        provider_changed: false,
        assistant_id_changed: false,
        contract_version: "1.0",
        public_reply_only: true,
        raw_text_logged: false,
        full_prompt_logged: false,
        responses_api_used: false,
      },
    });
  });
}

export async function buildServer() {
  const env = loadEnv();
  validateProductionEnv(env);

  const app = Fastify({ logger: false });
  const DATA_DIR = resolve("data");

  // Single Instance Guard
  const LOCK_FILE = resolve(DATA_DIR, "runtime.lock");
  const fs = await import("node:fs");
  if (fs.existsSync(LOCK_FILE)) {
    const oldPid = parseInt(fs.readFileSync(LOCK_FILE, "utf8"), 10);
    if (!isNaN(oldPid)) {
      let isRunning = false;
      try {
        process.kill(oldPid, 0);
        isRunning = true;
      } catch (e: any) {
        if (e.code === "EPERM") isRunning = true;
      }
      
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
  const maintenanceStore = new PersistentMaintenanceStore(resolve(DATA_DIR, "maintenance.json"));
  const actionAuditStore = new PersistentActionAuditStore(resolve(DATA_DIR, "audit_log.json"));
  const socialLeadStore = new PersistentSocialLeadStore(resolve(DATA_DIR, "social_leads.json"));
  const whatsappLearningStore = new FileWhatsAppLearningStore(resolve(DATA_DIR, "whatsapp_learning_messages.json"));
  const whatsappVisualResearchStore = new FileWhatsAppVisualResearchStore(resolve(DATA_DIR, "whatsapp_visual_research.json"));
  const assistantClient = new OpenAIAssistantClient(env.openaiApiKey, env.openaiAssistantId);
  let responsesShadowService: ResponsesShadowService | undefined;
  if (env.responsesShadowEnabled && env.responsesShadowMode !== "off" && env.openaiResponsesModel) {
    const responsesAdapter = await createOpenAIResponsesAdapter({
      apiKey: env.openaiApiKey,
      model: env.openaiResponsesModel,
    });
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
  const modelExecutionService = new ModelExecutionService(
    assistantClient,
    persistentStore.threadStore,
    {
      modelAdapterLayerEnabled: env.modelAdapterLayerEnabled,
      modelAdapterCanaryMode: env.modelAdapterCanaryMode,
      modelExecutionTimeoutEnabled: env.modelExecutionTimeoutEnabled,
      modelExecutionTimeoutMsConfigured: env.modelExecutionTimeoutMs > 0,
      responsesShadowObserver: responsesShadowService,
    },
  );
  const connectionHealthMonitor = new ConnectionHealthMonitor({
    evolutionInstance: env.evolutionInstance,
    evolutionApiBaseUrl: env.evolutionApiBaseUrl,
    evolutionApiKey: env.evolutionApiKey,
    logger,
    modeSnapshotProvider: () => ({
      inbound_queue_mode: env.webhookQueueMode,
      outbound_queue_mode: env.outboundQueueMode,
      fast_ack_enabled: env.fastAckEnabled,
      workers_enabled: env.workersEnabled,
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

  registerEvolutionWebhook(app, {
    env,
    assistantClient,
    modelExecutionService,
    sender: new EvolutionApiSender(env),
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
      listLearningSuggestions: () => ingestionStore.listLearningSuggestions()
    },
    ingestionStore,
    publisherStore: persistentStore.publisherStore,
    dailyReportStore: persistentStore.dailyReportStore,
    maintenanceStore,
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
    whatsappVisualResearchStore
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
