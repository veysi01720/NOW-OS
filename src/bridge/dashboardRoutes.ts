import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createHash } from "node:crypto";
import type { EnvConfig } from "../config/env.js";
import type { ReportDataSource } from "../storage/types.js";
import type { MaintenanceStore } from "../store/maintenanceStore.js";
import type { ActionAuditStore, DashboardActionAuditV1 } from "../store/actionAuditStore.js";
import { buildDailyOwnerReport } from "./dailyOwnerReport.js";
import { dashboardHtml } from "./dashboardHtml.js";
import { runBackup, getLatestBackupStatus } from "../utils/backupHelper.js";
import { buildAnalyticsSnapshot } from "../analytics/analyticsService.js";
import { getSafeConfigSummary } from "../config/envValidator.js";

export interface DashboardDeps {
  env: EnvConfig;
  reportDataSource: ReportDataSource;
  maintenanceStore: MaintenanceStore;
  actionAuditStore: ActionAuditStore;
  queueStore: import("../storage/types.js").QueueStore;
  ingestionStore?: import("../storage/ingestionStore.js").PersistentIngestionStore;
  publisherStore?: import("../storage/types.js").PublisherStore;
  ingestionJobStore?: import("../storage/ingestionJobStore.js").PersistentIngestionJobStore;
  normalizedMessageStore?: import("../storage/normalizedMessageStore.js").PersistentNormalizedMessageStore;
  scheduledReportConfigStore?: import("../store/scheduledReportStore.js").PersistentScheduledReportConfigStore;
  scheduledReportRunStore?: import("../store/scheduledReportStore.js").PersistentScheduledReportRunStore;
  dailyReportScheduler?: import("../utils/dailyReportScheduler.js").DailyReportSchedulerService;
  socialLeadStore?: import("../store/socialLeadStore.js").PersistentSocialLeadStore;
  whatsappLearningStore?: import("../store/whatsappLearningStore.js").PersistentWhatsAppLearningStore;
  whatsappVisualResearchStore?: import("../store/whatsappVisualResearchStore.js").PersistentWhatsAppVisualResearchStore;
}

export function registerDashboardRoutes(app: FastifyInstance, deps: DashboardDeps): void {
  const requireAuth = (req: FastifyRequest, reply: FastifyReply, done: () => void) => {
    const token = req.headers["x-dashboard-token"];
    const authHeader = req.headers["x-dashboard-token"] as string | undefined;
    const isTestOverride = process.env.NODE_ENV === "test" || process.env.SPEC_SYNTHETIC_MODE === "true";
    let role: "owner" | "manager" | null = null;
    let source: DashboardActionAuditV1["role_resolution_source"] | null = null;

    if (!authHeader) {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }

    const finalToken = authHeader.split(' ')[1] || authHeader;
    console.log("Auth Check: token=", finalToken, " owner=", deps.env.dashboardOwnerToken, " admin=", deps.env.dashboardAdminToken, " manager=", deps.env.dashboardManagerToken);
    
    if ((finalToken === deps.env.dashboardOwnerToken || finalToken === process.env.DASHBOARD_OWNER_TOKEN) && deps.env.dashboardOwnerToken !== "") {
      role = "owner";
      source = "owner_token";
    } else if ((finalToken === deps.env.dashboardManagerToken || finalToken === process.env.DASHBOARD_MANAGER_TOKEN) && deps.env.dashboardManagerToken !== "") {
      role = "manager";
      source = "manager_token";
    } else if (finalToken === deps.env.dashboardAdminToken && deps.env.dashboardAdminToken !== "") {
      role = "owner";
      source = "legacy_admin_owner";
    }

    if (!role) {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }

    if (isTestOverride && req.headers["x-actor-role"]) {
      role = req.headers["x-actor-role"] as "owner" | "manager";
      source = "test_override";
    }

    (req as any).actor_role = role;
    (req as any).role_resolution_source = source;
    done();
  };

  app.get("/dashboard", async (req, reply) => {
    return reply.type("text/html").send(dashboardHtml);
  });

  app.get("/dashboard/system/readyz", { preHandler: requireAuth }, async (req, reply) => {
    const backupStatus = process.env.NODE_ENV === "test" || process.env.SPEC_SYNTHETIC_MODE === "true"
      ? { last_backup_at: null, status: "unknown" }
      : getLatestBackupStatus();

    const schedulerEnabled = deps.scheduledReportConfigStore?.getConfig()?.enabled ?? false;

    return reply.send({
      ...getSafeConfigSummary(deps.env),
      storage_status: "ok",
      backup_status: backupStatus,
      scheduler_status: schedulerEnabled ? "enabled" : "disabled"
    });
  });

  app.get("/dashboard/health", { preHandler: requireAuth }, async (req, reply) => {
    return reply.send({ status: "ok", maintenance_mode: deps.maintenanceStore.isEnabled() });
  });

  app.get("/dashboard/summary", { preHandler: requireAuth }, async (req, reply) => {
    const dummyDailyReportStore = {
      markDailyReportGenerated: () => {},
      checkDailyReportDuplicate: () => false
    };

    const report = buildDailyOwnerReport(
      deps.reportDataSource,
      dummyDailyReportStore as any,
      deps.env,
      deps.maintenanceStore.isEnabled(),
      "owner",
      "manual"
    );

    const sanitized = {
      contract_version: "1.0",
      generated_at: new Date().toISOString(),
      timezone: "UTC",
      system_status: deps.maintenanceStore.isEnabled() ? "maintenance" : "online",
      daily_report_summary: {
        total_candidates: report.candidate_summary.total_candidates,
        open_follow_up_count: report.queue_summary.open_follow_up_count,
        high_priority_count: report.queue_summary.high_priority_count
      },
      candidate_summary: report.candidate_summary,
      publisher_summary: report.publisher_summary,
      queue_summary: report.queue_summary,
      queue_items: deps.reportDataSource.listQueueItems().filter(q => q.status === 'open').map(q => ({
        safe_ref: q.safe_ref,
        priority: q.priority,
        reason: q.reason,
        last_seen_at: q.last_seen_at
      })),
      publishers: deps.reportDataSource.listPublishers().map(p => ({
        safe_ref: p.safe_ref,
        display_name: p.display_name,
        activity_status: p.activity_status,
        updated_at: p.updated_at
      })),
      group_summary: report.group_summary,
      learning_summary: report.learning_summary,
      pending_learning_items: deps.ingestionStore?.listLearningSuggestions().filter(l => l.status === "pending_owner_review").map(l => ({
        safe_ref: l.safe_ref,
        status: l.status,
        suggestion_class: l.suggestion_class,
        proposed_knowledge_type: l.proposed_knowledge_type,
        evidence_preview_sanitized: l.evidence_preview_sanitized.substring(0, 500).replace(/<[^>]*>?/gm, ""),
        proposed_text_sanitized: l.proposed_text.substring(0, 500).replace(/<[^>]*>?/gm, ""),
        created_at: l.created_at
      })) || [],
      knowledge_summary: report.knowledge_summary,
      production_summary: report.production_summary,
      blockers: report.production_summary.blockers,
      suggested_actions: report.suggested_actions,
      data_quality_notes: report.data_quality_notes,
      backup_status: getLatestBackupStatus((deps.env as any).backupsDir)
    };

    return reply.send(sanitized);
  });

  const checkIdempotency = (req: FastifyRequest, reply: FastifyReply, done: () => void) => {
    const key = req.headers["x-idempotency-key"] as string;
    if (key && deps.actionAuditStore.hasIdempotencyKey(key)) {
      deps.actionAuditStore.logAction({
        action_type: "idempotency_duplicate_block",
        actor_role: (req as any).actor_role,
        actor_masked_ref: "safe-token-hash",
        role_resolution_source: (req as any).role_resolution_source,
        target_type: "system",
        target_safe_ref: "global",
        risk_level: "LOW",
        confirm_required: false,
        confirmed: false,
        result_status: "skipped_duplicate",
        idempotency_key_hash: key
      });
      reply.code(200).send({ status: "skipped_duplicate", message: "Action already executed" });
      return;
    }
    done();
  };

  app.post("/dashboard/actions/daily-report/generate", { preHandler: [requireAuth, checkIdempotency] }, async (req, reply) => {
    const key = req.headers["x-idempotency-key"] as string | undefined;
    
    deps.actionAuditStore.logAction({
      action_type: "daily_report_generate",
      actor_role: (req as any).actor_role,
      actor_masked_ref: "safe-token-hash",
      role_resolution_source: (req as any).role_resolution_source,
      target_type: "daily_report",
      target_safe_ref: "now",
      risk_level: "LOW",
      confirm_required: false,
      confirmed: true,
      result_status: "success",
      idempotency_key_hash: key
    });
    
    return reply.send({ status: "success", message: "Daily report manual generation safe endpoint called." });
  });

  app.post("/dashboard/actions/backup/run", { preHandler: [requireAuth, checkIdempotency] }, async (req, reply) => {
    const key = req.headers["x-idempotency-key"] as string | undefined;
    const body = req.body as { confirm?: boolean; reason?: string };
    
    if ((req as any).actor_role !== "owner") {
      return reply.code(403).send({ error: "Forbidden: Owner only" });
    }
    
    if (!body?.confirm) {
      return reply.code(400).send({ error: "Confirmation required" });
    }
    
    const backupResult = runBackup((deps.env as any).dataDir, (deps.env as any).backupsDir);
    
    let sanitizedReason: string | undefined;
    if (body.reason) {
      sanitizedReason = body.reason.replace(/<[^>]*>?/gm, "").substring(0, 250);
    }

    deps.actionAuditStore.logAction({
      action_type: "backup_run",
      actor_role: (req as any).actor_role,
      actor_masked_ref: "safe-token-hash",
      role_resolution_source: (req as any).role_resolution_source,
      target_type: "system",
      target_safe_ref: backupResult.backupSafeRef,
      risk_level: "HIGH",
      confirm_required: true,
      confirmed: true,
      result_status: "success",
      idempotency_key_hash: key,
      sanitized_reason: sanitizedReason
    });
    
    return reply.send({ status: "success", message: "Backup completed successfully.", backup_safe_ref: backupResult.backupSafeRef });
  });

  app.post("/dashboard/actions/maintenance", { preHandler: [requireAuth, checkIdempotency] }, async (req, reply) => {
    const key = req.headers["x-idempotency-key"] as string | undefined;
    const body = req.body as { desired_state?: "on" | "off"; reason?: string; confirm?: boolean };

    if ((req as any).actor_role !== "owner") {
      return reply.code(403).send({ error: "Forbidden: Owner only" });
    }

    if (!body?.desired_state || !["on", "off"].includes(body.desired_state)) {
      return reply.code(400).send({ error: "Invalid desired_state" });
    }

    if (!body?.confirm) {
      return reply.code(400).send({ error: "Confirmation required" });
    }

    deps.maintenanceStore.setEnabled(body.desired_state === "on");

    let sanitizedReason: string | undefined;
    if (body.reason) {
      sanitizedReason = body.reason.replace(/<[^>]*>?/gm, "").substring(0, 250);
    }

    deps.actionAuditStore.logAction({
      action_type: body.desired_state === "on" ? "maintenance_on" : "maintenance_off",
      actor_role: (req as any).actor_role,
      actor_masked_ref: "safe-token-hash",
      role_resolution_source: (req as any).role_resolution_source,
      target_type: "system",
      target_safe_ref: "maintenance_mode",
      risk_level: "HIGH",
      confirm_required: true,
      confirmed: true,
      result_status: "success",
      idempotency_key_hash: key,
      sanitized_reason: sanitizedReason
    });

    return reply.send({ status: "success", new_state: body.desired_state, message: `Maintenance mode is now ${body.desired_state.toUpperCase()}` });
  });

  app.post("/dashboard/actions/queue/resolve", { preHandler: [requireAuth, checkIdempotency] }, async (req, reply) => {
    const key = req.headers["x-idempotency-key"] as string | undefined;
    const body = req.body as { queue_ref?: string; reason?: string; confirm?: boolean };

    if (!body?.confirm) {
      return reply.code(400).send({ error: "Confirmation required" });
    }
    
    if (!body?.queue_ref) {
      return reply.code(400).send({ error: "queue_ref required" });
    }

    const resolvedItem = deps.queueStore.resolveOpenItemBySafeRef(body.queue_ref);
    if (!resolvedItem) {
      return reply.code(404).send({ error: "Queue item not found or already resolved" });
    }

    let sanitizedReason: string | undefined;
    if (body.reason) {
      sanitizedReason = body.reason.replace(/<[^>]*>?/gm, "").substring(0, 250);
    }

    deps.actionAuditStore.logAction({
      action_type: "queue_resolve",
      actor_role: (req as any).actor_role,
      actor_masked_ref: "safe-token-hash",
      role_resolution_source: (req as any).role_resolution_source,
      target_type: "queue",
      target_safe_ref: body.queue_ref,
      risk_level: "MEDIUM",
      confirm_required: true,
      confirmed: true,
      result_status: "success",
      idempotency_key_hash: key,
      sanitized_reason: sanitizedReason
    });

    return reply.send({ status: "success", message: `Queue item ${body.queue_ref} resolved.` });
  });

  app.post("/dashboard/actions/learning/review", { preHandler: [requireAuth, checkIdempotency] }, async (req, reply) => {
    const key = req.headers["x-idempotency-key"] as string | undefined;
    const body = req.body as { learning_ref?: string; decision?: "approve" | "reject" | "archive"; reason?: string; confirm?: boolean };

    if ((req as any).actor_role !== "owner") {
      return reply.code(403).send({ error: "Forbidden: Owner only" });
    }

    if (!body?.confirm) {
      return reply.code(400).send({ error: "Confirmation required" });
    }

    if (!body?.learning_ref) {
      return reply.code(400).send({ error: "learning_ref required" });
    }

    if (!body?.decision || !["approve", "reject", "archive"].includes(body.decision)) {
      return reply.code(400).send({ error: "Invalid decision" });
    }

    const suggestion = deps.ingestionStore?.resolveSuggestionBySafeRef(body.learning_ref);
    if (!suggestion) {
      return reply.code(404).send({ error: "Learning suggestion not found" });
    }

    const decisionMap = {
      approve: "approved",
      reject: "rejected",
      archive: "archived"
    } as const;
    const targetStatus = decisionMap[body.decision];

    if (suggestion.status !== "pending_owner_review") {
      if (suggestion.status === targetStatus) {
        return reply.send({ status: "success", message: `Learning suggestion already ${targetStatus}.`, idempotent: true });
      } else {
        return reply.code(409).send({ error: `Invalid transition. Suggestion is already ${suggestion.status}.` });
      }
    }

    let sanitizedReason: string | undefined;
    if (body.reason) {
      sanitizedReason = body.reason.replace(/<[^>]*>?/gm, "").substring(0, 250);
    }

    deps.ingestionStore?.reviewSuggestionBySafeRef(body.learning_ref, targetStatus, "owner");

    deps.actionAuditStore.logAction({
      action_type: `learning_${body.decision}` as "learning_approve" | "learning_reject" | "learning_archive",
      actor_role: "owner",
      actor_masked_ref: "safe-token-hash",
      role_resolution_source: (req as any).role_resolution_source,
      target_type: "learning",
      target_safe_ref: body.learning_ref,
      risk_level: "HIGH",
      confirm_required: true,
      confirmed: true,
      result_status: "success",
      idempotency_key_hash: key,
      sanitized_reason: sanitizedReason
    });

    return reply.send({ status: "success", message: `Learning suggestion ${body.learning_ref} ${targetStatus}.` });
  });

  app.post("/dashboard/actions/publisher/status", { preHandler: [requireAuth, checkIdempotency] }, async (req, reply) => {
    const key = req.headers["x-idempotency-key"] as string | undefined;
    const body = req.body as { publisher_ref?: string; status?: string; reason?: string; confirm?: boolean };

    if (!body?.confirm) {
      return reply.code(400).send({ error: "Confirmation required" });
    }

    if (!body?.publisher_ref) {
      return reply.code(400).send({ error: "publisher_ref required" });
    }

    const allowedStatuses = ["active", "inactive", "training_pending", "installation_pending", "support_needed", "paused"];
    if (!body?.status || !allowedStatuses.includes(body.status)) {
      return reply.code(400).send({ error: "Invalid status" });
    }

    const updateResult = deps.publisherStore?.updatePublisherStatusBySafeRef(body.publisher_ref, body.status as any);
    if (!updateResult || !updateResult.found) {
      return reply.code(404).send({ error: "Publisher not found" });
    }

    if (updateResult.already_current) {
      return reply.send({ status: "already_current", message: "Publisher is already in the requested status." });
    }

    let sanitizedReason: string | undefined;
    if (body.reason) {
      sanitizedReason = body.reason.replace(/<[^>]*>?/gm, "").substring(0, 250);
    }

    deps.actionAuditStore.logAction({
      action_type: "publisher_status_update",
      actor_role: (req as any).actor_role,
      actor_masked_ref: "safe-token-hash",
      role_resolution_source: (req as any).role_resolution_source,
      target_type: "publisher",
      target_safe_ref: body.publisher_ref,
      risk_level: "MEDIUM",
      confirm_required: true,
      confirmed: true,
      result_status: "success",
      previous_status: updateResult.previous_status,
      new_status: updateResult.new_status,
      idempotency_key_hash: key,
      sanitized_reason: sanitizedReason
    });

    return reply.send({ status: "success", message: `Publisher ${body.publisher_ref} status updated to ${body.status}.` });
  });

  app.post("/dashboard/actions/ingestion/manual-import", { preHandler: [requireAuth, checkIdempotency] }, async (req, reply) => {
    const key = req.headers["x-idempotency-key"] as string | undefined;
    const body = req.body as {
      format?: "json" | "csv";
      content?: string;
      platform?: string;
      source_type?: string;
      source_label_safe?: string;
      confirm?: boolean;
    };

    if (!body?.confirm) {
      return reply.code(400).send({ error: "Confirmation required" });
    }
    
    if (!key) {
      return reply.code(400).send({ error: "x-idempotency-key required" });
    }

    if (!body?.format || !["json", "csv"].includes(body.format)) {
      return reply.code(400).send({ error: "Valid format required (json, csv)" });
    }

    if (!body?.content || typeof body.content !== "string") {
      return reply.code(400).send({ error: "content required" });
    }

    // Size limit check (default 5MB)
    const maxBytes = parseInt(process.env.MAX_IMPORT_BYTES || "5242880", 10);
    if (Buffer.byteLength(body.content, "utf8") > maxBytes) {
      return reply.code(413).send({ error: "Payload too large" });
    }

    if (!deps.ingestionJobStore || !deps.normalizedMessageStore) {
      return reply.code(500).send({ error: "Ingestion stores not configured" });
    }

    // Run import job synchronously for V1
    const importService = await import("../connectors/importService.js");
    const job = importService.runManualImportJob(
      {
        format: body.format,
        content: body.content, // memory only, not logged
        platform: body.platform || "unknown",
        source_type: body.source_type || "unknown",
        source_label_safe: body.source_label_safe,
        created_by_role: (req as any).actor_role
      },
      deps.ingestionJobStore,
      deps.normalizedMessageStore
    );

    // Audit log (MUST NEVER INCLUDE RAW CONTENT)
    deps.actionAuditStore.logAction({
      action_type: "ingestion_manual_import",
      actor_role: (req as any).actor_role,
      actor_masked_ref: "safe-token-hash",
      role_resolution_source: (req as any).role_resolution_source,
      target_type: "system",
      target_safe_ref: job.job_ref,
      risk_level: "HIGH",
      confirm_required: true,
      confirmed: true,
      result_status: job.status as any,
      idempotency_key_hash: key,
      imported_count: job.imported_count,
      skipped_duplicate_count: job.skipped_duplicate_count,
      rejected_count: job.rejected_count,
      sanitized_error: job.sanitized_error,
      platform: job.platform,
      source_type: job.source_type,
      source_label_safe: job.source_label_safe,
      import_batch_ref: job.import_batch_ref
    });

    return reply.send({
      status: job.status,
      message: "Import execution completed",
      job_ref: job.job_ref,
      imported_count: job.imported_count,
      skipped_duplicate_count: job.skipped_duplicate_count,
      rejected_count: job.rejected_count,
      sanitized_error: job.sanitized_error
    });
  });

  app.post("/dashboard/actions/ingestion/generate-learning", { preHandler: [requireAuth, checkIdempotency] }, async (req, reply) => {
    const key = req.headers["x-idempotency-key"] as string | undefined;
    const body = req.body as {
      job_ref?: string;
      platform?: string;
      reason?: string;
      confirm?: boolean;
    };

    if (!body?.confirm) {
      return reply.code(400).send({ error: "Confirmation required" });
    }

    if (!key) {
      return reply.code(400).send({ error: "x-idempotency-key required" });
    }

    if (!deps.ingestionStore || !deps.normalizedMessageStore) {
      return reply.code(500).send({ error: "Ingestion stores not configured" });
    }

    let messages = deps.normalizedMessageStore.listMessages();
    
    if (body.job_ref) {
      messages = messages.filter(m => (m as any).ingestion_job_ref === body.job_ref);
    }
    if (body.platform) {
      messages = messages.filter(m => m.platform === body.platform);
    }

    // Limit if no filters
    if (!body.job_ref && !body.platform) {
      messages = messages.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 1000);
    }

    let generated_count = 0;
    let skipped_duplicate_count = 0;
    const rejected_count = 0;

    const createHash = (crypto: typeof import("crypto")) => (str: string) => crypto.createHash("sha256").update(str).digest("hex");
    const hashFn = createHash(await import("crypto"));

    for (const m of messages) {
      // 1. Candidate Selection
      const intents = m.detected_intents || [];
      let suggestion_class: import("../storage/ingestionTypes.js").IngestionClass = "unknown";
      let proposed_type = "public_faq";

      if (intents.includes("support_signal")) suggestion_class = "support_signal";
      else if (intents.includes("installation_question")) suggestion_class = "installation_problem";
      else if (intents.includes("payment_or_trust_question")) suggestion_class = "payment_or_trust_question";
      else if (intents.includes("training_question")) suggestion_class = "training_question";
      else if (intents.includes("rule_violation_signal")) {
        suggestion_class = "rule_violation";
        proposed_type = "internal_boss_note";
      }

      if (suggestion_class === "unknown") {
        // Unknown intent skipped by design
        continue;
      }

      const textSanitized = m.message_text_sanitized || "";
      const evidence = textSanitized.length > 500 ? textSanitized.substring(0, 500) + "... [truncated]" : textSanitized;
      const proposed_text = `Suggested knowledge based on: ${evidence.substring(0, 50)}`;
      
      const contentHash = hashFn(textSanitized);
      const dedup_key = hashFn(`${m.message_ref}:${suggestion_class}:${contentHash}`);

      // 2. Duplicate Check
      // We look for existing suggestions with this dedup key logic.
      // Since LearningSuggestion doesn't explicitly store dedup_key in file yet, we match manually.
      const existing = deps.ingestionStore.listLearningSuggestions();
      const isDup = existing.some(s => 
        s.source_message_safe_ref === m.message_ref &&
        s.suggested_category === suggestion_class &&
        hashFn(s.evidence_preview_sanitized.replace("... [truncated]", "")) === contentHash // rough fallback check, but sufficient with exact message_ref
      );

      if (isDup) {
        skipped_duplicate_count++;
        continue;
      }

      const suggestionId = `SUG-${Date.now()}-${Math.random().toString(36).substring(2,8)}`;
      deps.ingestionStore.saveLearningSuggestion({
        suggestion_id: suggestionId,
        source_job_id: (m as any).ingestion_job_ref || "manual_gen",
        platform: m.platform,
        suggestion_class,
        evidence_preview_sanitized: evidence,
        proposed_knowledge_type: proposed_type,
        proposed_text,
        confidence: 0.8,
        status: "pending_owner_review",
        created_at: new Date().toISOString(),
        source_type: "ingestion_normalized_message",
        source_message_safe_ref: m.message_ref,
        source_label_safe: m.source_label_safe,
        import_batch_ref: m.import_batch_ref,
        suggested_category: suggestion_class
      });

      generated_count++;
    }

    let sanitizedReason: string | undefined;
    if (body.reason) {
      sanitizedReason = body.reason.replace(/<[^>]*>?/gm, "").substring(0, 250);
    }

    deps.actionAuditStore.logAction({
      action_type: "ingestion_generate_learning",
      actor_role: (req as any).actor_role,
      actor_masked_ref: "safe-token-hash",
      role_resolution_source: (req as any).role_resolution_source,
      target_type: "system",
      target_safe_ref: body.job_ref || "all",
      risk_level: "MEDIUM",
      confirm_required: true,
      confirmed: true,
      result_status: "success",
      idempotency_key_hash: key,
      generated_count,
      skipped_duplicate_count,
      rejected_count,
      sanitized_reason: sanitizedReason,
      platform: body.platform
    });

    return reply.send({
      status: "success",
      message: `Generated ${generated_count} learning suggestions. Skipped ${skipped_duplicate_count} duplicates.`,
      generated_count,
      skipped_duplicate_count
    });
  });

  app.get("/dashboard/connectors/summary", { preHandler: requireAuth }, async (req, reply) => {
    if (!deps.ingestionJobStore || !deps.normalizedMessageStore) {
      return reply.code(500).send({ error: "Ingestion stores not configured" });
    }

    const jobs = deps.ingestionJobStore.listJobs();
    
    let total_imported_messages = 0;
    let total_skipped_duplicates = 0;
    let total_rejected_rows = 0;
    
    const jobs_by_status = { completed: 0, failed: 0, partial: 0, running: 0, pending: 0 };
    const metrics_by_platform: Record<string, { imported: number; skipped: number; rejected: number }> = {};
    const latest_jobs = [];
    const source_labels = new Set<string>();

    for (const j of jobs) {
      if (jobs_by_status[j.status] !== undefined) jobs_by_status[j.status]++;
      total_imported_messages += j.imported_count || 0;
      total_skipped_duplicates += j.skipped_duplicate_count || 0;
      total_rejected_rows += j.rejected_count || 0;

      if (!metrics_by_platform[j.platform]) {
        metrics_by_platform[j.platform] = { imported: 0, skipped: 0, rejected: 0 };
      }
      metrics_by_platform[j.platform].imported += j.imported_count || 0;
      metrics_by_platform[j.platform].skipped += j.skipped_duplicate_count || 0;
      metrics_by_platform[j.platform].rejected += j.rejected_count || 0;

      if (j.source_label_safe) {
        source_labels.add(j.source_label_safe);
      }
    }

    // Sort descending by started_at
    const sortedJobs = [...jobs].sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
    
    for (let i = 0; i < Math.min(10, sortedJobs.length); i++) {
      latest_jobs.push({
        job_ref: sortedJobs[i].job_ref,
        platform: sortedJobs[i].platform,
        source_type: sortedJobs[i].source_type,
        status: sortedJobs[i].status,
        imported_count: sortedJobs[i].imported_count,
        skipped_duplicate_count: sortedJobs[i].skipped_duplicate_count,
        rejected_count: sortedJobs[i].rejected_count,
        sanitized_error: sortedJobs[i].sanitized_error,
        started_at: sortedJobs[i].started_at,
        source_label_safe: sortedJobs[i].source_label_safe
      });
    }

    const total_ingestion_jobs = jobs.length;
    const total_normalized_messages = jobs.reduce((sum, j) => sum + deps.normalizedMessageStore!.countByJobRef(j.job_ref), 0);

    const data_quality_notes: string[] = [];
    const suggested_actions: string[] = [];
    
    if (jobs_by_status.failed > 0) data_quality_notes.push(`There are ${jobs_by_status.failed} failed ingestion jobs.`);
    if (jobs_by_status.partial > 0) data_quality_notes.push(`There are ${jobs_by_status.partial} partially successful jobs with rejected rows.`);

    const allSuggestions = deps.ingestionStore?.listLearningSuggestions() || [];
    const generated_learning_suggestions_count = allSuggestions.filter(s => s.source_type === 'ingestion_normalized_message').length;
    const pending_learning_from_ingestion_count = allSuggestions.filter(s => s.status === 'pending_owner_review' && s.source_type === 'ingestion_normalized_message').length;

    if (pending_learning_from_ingestion_count > 0) {
      suggested_actions.push(`Review ${pending_learning_from_ingestion_count} pending learning suggestions generated from imports.`);
    }

    return reply.send({
      total_ingestion_jobs,
      total_imported_messages,
      total_skipped_duplicates,
      total_rejected_rows,
      jobs_by_status,
      metrics_by_platform,
      latest_jobs,
      recent_source_labels: Array.from(source_labels).slice(0, 20),
      data_quality_notes,
      suggested_actions,
      total_normalized_messages,
      generated_learning_suggestions_count,
      pending_learning_from_ingestion_count
    });
  });

  app.get("/dashboard/connectors/jobs", { preHandler: requireAuth }, async (req, reply) => {
    if (!deps.ingestionJobStore) {
      return reply.code(500).send({ error: "Ingestion store not configured" });
    }
    const jobs = deps.ingestionJobStore.listJobs().sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
    const safeJobs = jobs.map(j => ({
      job_ref: j.job_ref,
      platform: j.platform,
      source_type: j.source_type,
      status: j.status,
      started_at: j.started_at,
      completed_at: j.completed_at,
      imported_count: j.imported_count,
      skipped_duplicate_count: j.skipped_duplicate_count,
      rejected_count: j.rejected_count,
      sanitized_error: j.sanitized_error,
      source_label_safe: j.source_label_safe,
      import_batch_ref: j.import_batch_ref
    }));
    return reply.send({ jobs: safeJobs });
  });

  app.get("/dashboard/connectors/messages", { preHandler: requireAuth }, async (req, reply) => {
    const job_ref = (req.query as any).job_ref;
    if (!job_ref) {
      return reply.code(400).send({ error: "job_ref query parameter is required" });
    }
    if (!deps.normalizedMessageStore) {
      return reply.code(500).send({ error: "Normalized store not configured" });
    }

    const messages = deps.normalizedMessageStore.listByJobRef(job_ref);
    
    // Strict allowlist mapping
    const safeMessages = messages.map(m => {
      // Apply message text cap (e.g. 1000 chars)
      let text = m.message_text_sanitized || "";
      if (text.length > 1000) {
        text = text.substring(0, 1000) + "... [truncated]";
      }

      return {
        message_ref: m.message_ref,
        platform: m.platform,
        source_type: m.source_type,
        source_safe_ref: m.source_safe_ref,
        sender_safe_ref: m.sender_safe_ref,
        sender_role_hint: m.sender_role_hint,
        message_text_sanitized: text,
        timestamp: m.timestamp,
        direction: m.direction,
        detected_intents: m.detected_intents || [],
        risk_flags: m.risk_flags || [],
        ingestion_job_ref: (m as any).ingestion_job_ref,
        campaign_safe_ref: m.campaign_safe_ref,
        source_label_safe: m.source_label_safe,
        import_batch_ref: m.import_batch_ref,
        external_context_hash: m.external_context_hash
      };
    });

    return reply.send({ messages: safeMessages });
  });

  app.get("/dashboard/actions/audit", { preHandler: requireAuth }, async (req, reply) => {
    const logs = deps.actionAuditStore.getRecentLogs(50);
    return reply.send({ logs });
  });

  app.get("/dashboard/scheduled-reports/config", { preHandler: requireAuth }, async (req, reply) => {
    if (!deps.scheduledReportConfigStore) return reply.code(501).send({ error: "Not implemented" });
    return reply.send(deps.scheduledReportConfigStore.getConfig());
  });

  app.get("/dashboard/scheduled-reports/runs", { preHandler: requireAuth }, async (req, reply) => {
    if (!deps.scheduledReportRunStore) return reply.code(501).send({ error: "Not implemented" });
    return reply.send({ runs: deps.scheduledReportRunStore.getRuns(20) });
  });

  app.post("/dashboard/actions/scheduled-reports/update-config", { preHandler: [requireAuth, checkIdempotency] }, async (req, reply) => {
    if (!deps.scheduledReportConfigStore) return reply.code(501).send({ error: "Not implemented" });
    const key = req.headers["x-idempotency-key"] as string | undefined;
    const body = req.body as any;
    
    if (!body?.confirm) return reply.code(400).send({ error: "Confirmation required" });

    let isHighRisk = false;
    if (body.delivery_mode && body.delivery_mode.startsWith("whatsapp_")) isHighRisk = true;
    if (body.send_whatsapp === true) isHighRisk = true;
    if (body.dry_run === false) isHighRisk = true;

    if (isHighRisk && (req as any).actor_role !== "owner") {
      return reply.code(403).send({ error: "Forbidden: Owner only for high-risk config updates" });
    }

    const updated = deps.scheduledReportConfigStore.updateConfig("default", body);

    deps.actionAuditStore.logAction({
      action_type: "scheduled_report_update_config",
      actor_role: (req as any).actor_role,
      actor_masked_ref: "safe-token-hash",
      role_resolution_source: (req as any).role_resolution_source,
      target_type: "system",
      target_safe_ref: "scheduled_report",
      risk_level: isHighRisk ? "HIGH" : "MEDIUM",
      confirm_required: true,
      confirmed: true,
      result_status: "success",
      idempotency_key_hash: key
    });

    return reply.send({ status: "success", config: updated });
  });

  app.post("/dashboard/actions/scheduled-reports/enable", { preHandler: [requireAuth, checkIdempotency] }, async (req, reply) => {
    if (!deps.scheduledReportConfigStore) return reply.code(501).send({ error: "Not implemented" });
    const key = req.headers["x-idempotency-key"] as string | undefined;
    const body = req.body as any;
    
    if ((req as any).actor_role !== "owner") return reply.code(403).send({ error: "Forbidden: Owner only" });
    if (!body?.confirm) return reply.code(400).send({ error: "Confirmation required" });

    const updated = deps.scheduledReportConfigStore.updateConfig("default", { enabled: true });

    deps.actionAuditStore.logAction({
      action_type: "scheduled_report_enable",
      actor_role: (req as any).actor_role,
      actor_masked_ref: "safe-token-hash",
      role_resolution_source: (req as any).role_resolution_source,
      target_type: "system",
      target_safe_ref: "scheduled_report",
      risk_level: "MEDIUM",
      confirm_required: true,
      confirmed: true,
      result_status: "success",
      idempotency_key_hash: key
    });

    return reply.send({ status: "success", config: updated });
  });

  app.post("/dashboard/actions/scheduled-reports/disable", { preHandler: [requireAuth, checkIdempotency] }, async (req, reply) => {
    if (!deps.scheduledReportConfigStore) return reply.code(501).send({ error: "Not implemented" });
    const key = req.headers["x-idempotency-key"] as string | undefined;
    const body = req.body as any;
    
    if (!body?.confirm) return reply.code(400).send({ error: "Confirmation required" });

    const updated = deps.scheduledReportConfigStore.updateConfig("default", { enabled: false });

    deps.actionAuditStore.logAction({
      action_type: "scheduled_report_disable",
      actor_role: (req as any).actor_role,
      actor_masked_ref: "safe-token-hash",
      role_resolution_source: (req as any).role_resolution_source,
      target_type: "system",
      target_safe_ref: "scheduled_report",
      risk_level: "MEDIUM",
      confirm_required: true,
      confirmed: true,
      result_status: "success",
      idempotency_key_hash: key
    });

    return reply.send({ status: "success", config: updated });
  });

  app.post("/dashboard/actions/scheduled-reports/run-preview", { preHandler: [requireAuth, checkIdempotency] }, async (req, reply) => {
    if (!deps.dailyReportScheduler) return reply.code(501).send({ error: "Not implemented" });
    const key = req.headers["x-idempotency-key"] as string | undefined;

    const run = await deps.dailyReportScheduler.executeRun("manual_preview", (req as any).actor_role, new Date(), key);

    deps.actionAuditStore.logAction({
      action_type: "scheduled_report_run_preview",
      actor_role: (req as any).actor_role,
      actor_masked_ref: "safe-token-hash",
      role_resolution_source: (req as any).role_resolution_source,
      target_type: "system",
      target_safe_ref: run.run_ref,
      risk_level: "LOW",
      confirm_required: false,
      confirmed: true,
      result_status: "success",
      idempotency_key_hash: key
    });

    return reply.send({ status: "success", run });
  });

  app.post("/dashboard/actions/scheduled-reports/run-send", { preHandler: [requireAuth, checkIdempotency] }, async (req, reply) => {
    if (!deps.dailyReportScheduler) return reply.code(501).send({ error: "Not implemented" });
    const key = req.headers["x-idempotency-key"] as string | undefined;
    const body = req.body as any;

    if ((req as any).actor_role !== "owner") return reply.code(403).send({ error: "Forbidden: Owner only" });
    if (!body?.confirm) return reply.code(400).send({ error: "Confirmation required" });

    const run = await deps.dailyReportScheduler.executeRun("manual_send", (req as any).actor_role, new Date(), key);

    deps.actionAuditStore.logAction({
      action_type: "scheduled_report_run_send",
      actor_role: (req as any).actor_role,
      actor_masked_ref: "safe-token-hash",
      role_resolution_source: (req as any).role_resolution_source,
      target_type: "system",
      target_safe_ref: run.run_ref,
      risk_level: "HIGH",
      confirm_required: true,
      confirmed: true,
      result_status: run.status === "sent" ? "success" : "failure",
      sanitized_reason: run.error_sanitized || undefined,
      idempotency_key_hash: key
    });

    return reply.send({ status: run.status, run });
  });

  // SPEC-027 Analytics / Performance Dashboard
  app.get("/dashboard/analytics/summary", { preHandler: requireAuth }, async (req, reply) => {
    const period = (req.query as any).period || '7d';
    const snapshot = buildAnalyticsSnapshot({ period, deps });
    return reply.send(snapshot);
  });

  app.get("/dashboard/analytics/candidates", { preHandler: requireAuth }, async (req, reply) => {
    const period = (req.query as any).period || '7d';
    const snapshot = buildAnalyticsSnapshot({ period, deps });
    return reply.send({ candidate_metrics: snapshot.candidate_metrics, data_quality_notes: snapshot.data_quality_notes });
  });

  app.get("/dashboard/analytics/publishers", { preHandler: requireAuth }, async (req, reply) => {
    const period = (req.query as any).period || '7d';
    const snapshot = buildAnalyticsSnapshot({ period, deps });
    return reply.send({ publisher_metrics: snapshot.publisher_metrics, data_quality_notes: snapshot.data_quality_notes });
  });

  app.get("/dashboard/analytics/queues", { preHandler: requireAuth }, async (req, reply) => {
    const period = (req.query as any).period || '7d';
    const snapshot = buildAnalyticsSnapshot({ period, deps });
    return reply.send({ queue_metrics: snapshot.queue_metrics, data_quality_notes: snapshot.data_quality_notes });
  });

  app.get("/dashboard/analytics/learning", { preHandler: requireAuth }, async (req, reply) => {
    const period = (req.query as any).period || '7d';
    const snapshot = buildAnalyticsSnapshot({ period, deps });
    return reply.send({ learning_metrics: snapshot.learning_metrics, data_quality_notes: snapshot.data_quality_notes });
  });

  app.get("/dashboard/analytics/ingestion", { preHandler: requireAuth }, async (req, reply) => {
    const period = (req.query as any).period || '7d';
    const snapshot = buildAnalyticsSnapshot({ period, deps });
    return reply.send({ ingestion_metrics: snapshot.ingestion_metrics, data_quality_notes: snapshot.data_quality_notes });
  });

  app.get("/dashboard/analytics/reports", { preHandler: requireAuth }, async (req, reply) => {
    const period = (req.query as any).period || '7d';
    const snapshot = buildAnalyticsSnapshot({ period, deps });
    return reply.send({ report_metrics: snapshot.report_metrics, data_quality_notes: snapshot.data_quality_notes });
  });

  app.get("/dashboard/analytics/actions", { preHandler: requireAuth }, async (req, reply) => {
    const period = (req.query as any).period || '7d';
    const snapshot = buildAnalyticsSnapshot({ period, deps });
    return reply.send({ dashboard_action_metrics: snapshot.dashboard_action_metrics, data_quality_notes: snapshot.data_quality_notes });
  });

  // ============================================================================
  // SPEC-029: Social Intake Routes
  // ============================================================================

  app.get('/dashboard/social-intake/summary', { preHandler: requireAuth }, async (req, reply) => {
    if (!deps.socialLeadStore) return reply.code(501).send({ error: 'Social Lead Store not initialized' });
    return reply.send(deps.socialLeadStore.getMetrics());
  });

  app.get('/dashboard/social-intake/leads', { preHandler: requireAuth }, async (req, reply) => {
    if (!deps.socialLeadStore) return reply.code(501).send({ error: 'Social Lead Store not initialized' });
    const query = req.query as any;
    if (query.status) {
      return reply.send(deps.socialLeadStore.listByStatus(query.status));
    }
    return reply.send(deps.socialLeadStore.listLeads());
  });

  app.get('/dashboard/social-intake/lead', { preHandler: requireAuth }, async (req, reply) => {
    if (!deps.socialLeadStore) return reply.code(501).send({ error: 'Social Lead Store not initialized' });
    const query = req.query as any;
    const lead = deps.socialLeadStore.getByLeadRef(query.lead_ref);
    if (!lead) return reply.code(404).send({ error: 'Lead not found' });
    return reply.send(lead);
  });

  app.post('/dashboard/actions/social-intake/import', { preHandler: requireAuth }, async (req, reply) => {
    if (!deps.socialLeadStore) return reply.code(501).send({ error: 'Social Lead Store not initialized' });
    const body = req.body as any;
    const idempotencyKey = req.headers['x-idempotency-key'] as string;
    
    if (!idempotencyKey) return reply.code(400).send({ error: 'x-idempotency-key header is required' });
    if (body.confirm !== true) return reply.code(400).send({ error: 'confirm: true is required' });

    const keyHash = createHash('sha256').update(idempotencyKey).digest('hex');
    if (deps.actionAuditStore.hasIdempotencyKey(keyHash)) {
      return reply.code(409).send({ error: 'Duplicate action request rejected' });
    }

    const payload = body.payload;
    if (!payload) return reply.code(400).send({ error: 'payload is required' });

    if (JSON.stringify(payload).length > 50000) {
      return reply.code(413).send({ error: 'Payload too large' });
    }

    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const credentialRegex = /password|cookie|session|bearer|auth_token|access_token/i;
    if (credentialRegex.test(payloadStr)) {
      deps.actionAuditStore.logAction({
        action_type: 'social_intake_import',
        actor_role: (req as any).resolvedRole,
        actor_masked_ref: (req as any).resolvedTokenHint,
        role_resolution_source: 'owner_token',
        target_type: 'system',
        target_safe_ref: 'social_intake',
        risk_level: 'HIGH',
        confirm_required: true,
        confirmed: true,
        idempotency_key_hash: keyHash,
        result_status: 'failure',
        sanitized_error: 'Credential fields detected in payload',
        platform: body.platform,
        source_type: body.source_type,
        rejected_count: 1
      });
      return reply.code(400).send({ error: 'Credential-like fields detected. Request rejected.' });
    }

    const platform = body.platform || 'instagram';
    const source_type = body.source_type || 'manual_json';
    const campaign = body.campaign_safe_ref || '';
    
    let rows: any[] = [];
    try {
       rows = typeof payload === 'string' ? JSON.parse(payload) : payload;
       if (!Array.isArray(rows)) rows = [rows];
    } catch {
       return reply.code(400).send({ error: 'Invalid payload format. Must be JSON.' });
    }

    let imported_count = 0;
    let duplicate_count = 0;

    for (const row of rows) {
      const rawUser = row.username || row.display_name || 'unknown';
      const rawMsg = row.message || row.text || row.bio || '';
      
      const dedupHash = deps.socialLeadStore.generateDedupHash(platform, rawUser, rawMsg, campaign);
      if (deps.socialLeadStore.dedupExists(dedupHash)) {
        duplicate_count++;
        continue;
      }

      deps.socialLeadStore.createLead({
        platform,
        source_type,
        source_label_safe: body.source_label_safe || '',
        campaign_safe_ref: campaign,
        username_safe_hash: deps.socialLeadStore.hashString(rawUser),
        display_name_sanitized: (row.display_name || 'unknown').substring(0, 50).replace(/[^a-zA-Z0-9 ]/g, ''),
        message_preview_sanitized: rawMsg.substring(0, 200).replace(/<[^>]*>?/gm, ''),
        detected_intents: [],
        risk_flags: [],
        status: 'pending_review',
        created_at: new Date().toISOString(),
        imported_at: new Date().toISOString(),
        dedup_hash: dedupHash
      });
      imported_count++;
    }

    deps.actionAuditStore.logAction({
      action_type: 'social_intake_import',
      actor_role: (req as any).resolvedRole,
      actor_masked_ref: (req as any).resolvedTokenHint,
      role_resolution_source: 'owner_token',
      target_type: 'system',
      target_safe_ref: 'social_intake',
      risk_level: 'MEDIUM',
      confirm_required: true,
      confirmed: true,
      idempotency_key_hash: keyHash,
      result_status: 'success',
      platform,
      source_type,
      imported_count,
      duplicate_count
    });

    return reply.send({
      status: 'completed',
      imported_count,
      duplicate_count
    });
  });

  app.post('/dashboard/actions/social-intake/review', { preHandler: requireAuth }, async (req, reply) => {
    if (!deps.socialLeadStore) return reply.code(501).send({ error: 'Social Lead Store not initialized' });
    const body = req.body as any;
    const idempotencyKey = req.headers['x-idempotency-key'] as string;
    
    if (!idempotencyKey) return reply.code(400).send({ error: 'x-idempotency-key header is required' });
    const keyHash = createHash('sha256').update(idempotencyKey).digest('hex');
    if (deps.actionAuditStore.hasIdempotencyKey(keyHash)) {
      return reply.code(409).send({ error: 'Duplicate action request rejected' });
    }

    try {
      const lead = deps.socialLeadStore.markReviewed(body.lead_ref);
      if (!lead) return reply.code(404).send({ error: 'Lead not found' });

      deps.actionAuditStore.logAction({
        action_type: 'social_intake_review',
        actor_role: (req as any).resolvedRole,
        actor_masked_ref: (req as any).resolvedTokenHint,
        role_resolution_source: 'owner_token',
        target_type: 'system',
        target_safe_ref: lead.lead_ref,
        risk_level: 'LOW',
        confirm_required: false,
        confirmed: true,
        idempotency_key_hash: keyHash,
        result_status: 'success',
        new_status: 'reviewed'
      });

      return reply.send({ status: 'success', lead });
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post('/dashboard/actions/social-intake/archive', { preHandler: requireAuth }, async (req, reply) => {
    if (!deps.socialLeadStore) return reply.code(501).send({ error: 'Social Lead Store not initialized' });
    const body = req.body as any;
    if (body.confirm !== true) return reply.code(400).send({ error: 'confirm: true is required' });

    try {
      const lead = deps.socialLeadStore.archiveLead(body.lead_ref);
      if (!lead) return reply.code(404).send({ error: 'Lead not found' });
      return reply.send({ status: 'success', lead });
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post('/dashboard/actions/social-intake/convert-to-candidate', { preHandler: requireAuth }, async (req, reply) => {
    if (!deps.socialLeadStore) return reply.code(501).send({ error: 'Social Lead Store not initialized' });
    const body = req.body as any;
    const idempotencyKey = req.headers['x-idempotency-key'] as string;
    
    if (!idempotencyKey) return reply.code(400).send({ error: 'x-idempotency-key header is required' });
    if (body.confirm !== true) return reply.code(400).send({ error: 'confirm: true is required' });

    const keyHash = createHash('sha256').update(idempotencyKey).digest('hex');
    if (deps.actionAuditStore.hasIdempotencyKey(keyHash)) {
      return reply.code(409).send({ error: 'Duplicate action request rejected' });
    }

    try {
      const lead = deps.socialLeadStore.getByLeadRef(body.lead_ref);
      if (!lead) return reply.code(404).send({ error: 'Lead not found' });
      if (lead.status === 'converted_to_candidate') return reply.code(400).send({ error: 'Lead already converted' });
      if (lead.status === 'archived') return reply.code(400).send({ error: 'Cannot convert archived lead' });

      const candidate_user_id = "USR-SOCIAL-" + lead.username_safe_hash.substring(0,8);
      deps.queueStore.upsertOpenItem({
        user_id: candidate_user_id,
        sender_masked: "social_lead",
        reason: 'waiting_candidate_response',
        priority: 'LOW',
        current_state: "social_intake_conversion",
        missing_fields: [],
        expected_next_step: "contact_candidate",
        last_seen_at: new Date().toISOString(),
        last_user_message_preview: "Converted from social lead: " + lead.lead_ref,
        suggested_operator_action: "initiate_contact",
        safe_ref: lead.lead_ref
      });

      const updated = deps.socialLeadStore.markConverted(body.lead_ref);

      deps.actionAuditStore.logAction({
        action_type: 'social_intake_convert_to_candidate',
        actor_role: (req as any).resolvedRole,
        actor_masked_ref: (req as any).resolvedTokenHint,
        role_resolution_source: 'owner_token',
        target_type: 'system',
        target_safe_ref: lead.lead_ref,
        risk_level: 'MEDIUM',
        confirm_required: true,
        confirmed: true,
        idempotency_key_hash: keyHash,
        result_status: 'success',
        new_status: 'converted_to_candidate',
        converted_count: 1
      });

      return reply.send({ status: 'success', lead: updated });
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });
  app.get('/dashboard/whatsapp-learning/summary', { preHandler: requireAuth }, async (req, reply) => {
    if (!deps.whatsappLearningStore) return reply.code(500).send({ error: 'whatsappLearningStore not configured' });
    const summary = deps.whatsappLearningStore.getSummary();
    return reply.send(summary);
  });

  app.post('/dashboard/actions/whatsapp-learning/import', { preHandler: [requireAuth, checkIdempotency] }, async (req, reply) => {
    if (!deps.whatsappLearningStore) return reply.code(500).send({ error: 'whatsappLearningStore not configured' });
    const key = req.headers['x-idempotency-key'] as string | undefined;
    const body = req.body as { content?: string; format?: string; source_label_safe?: string; confirm?: boolean };
    
    if (!body?.confirm) return reply.code(400).send({ error: 'Confirmation required' });
    if (!key) return reply.code(400).send({ error: 'x-idempotency-key required' });
    if (!body?.content) return reply.code(400).send({ error: 'Content required' });
    
    const maxBytes = parseInt(process.env.MAX_IMPORT_BYTES || '5242880', 10);
    if (Buffer.byteLength(body.content, 'utf8') > maxBytes) return reply.code(413).send({ error: 'Payload too large' });

    const classifier = await import('../utils/whatsappLearningClassifier.js');
    const crypto = await import('node:crypto');
    const batch_ref = 'BAT-' + Date.now() + '-' + Math.random().toString(36).substring(2,6);

    let imported = 0;
    let skipped = 0;

    const lines = body.content.split('\n').filter(l => l.trim().length > 0);
    
    for (const line of lines) {
      const sanitized = line.replace(/\+?\d{10,15}/g, '[PHONE]').replace(/\b\d{4,}\b/g, '[NUM]');
      
      let speaker: 'owner' | 'manager' | 'candidate' | 'publisher' | 'unknown' = 'unknown';
      if (sanitized.toLowerCase().includes('admin') || sanitized.toLowerCase().includes('owner')) speaker = 'owner';
      else speaker = 'candidate';

      const isDup = deps.whatsappLearningStore.dedupExists(speaker, sanitized, 'copy_paste');
      if (isDup) {
        skipped++;
        continue;
      }

      const { detected_jargon, detected_faq, detected_objection, detected_training_point, detected_risk_flags, conversation_type } = classifier.classifyWhatsAppMessage(sanitized);
      
      deps.whatsappLearningStore.createMessage({
        message_ref: 'WLM-' + Date.now() + '-' + Math.random().toString(36).substring(2,8),
        source_type: 'copy_paste',
        speaker_role: speaker,
        conversation_type,
        message_text_sanitized: sanitized,
        detected_jargon,
        detected_faq,
        detected_objection,
        detected_training_point,
        detected_risk_flags,
        source_label_safe: body.source_label_safe || 'manual_import',
        import_batch_ref: batch_ref,
        created_at: new Date().toISOString()
      });
      imported++;
    }

    deps.actionAuditStore.logAction({
      action_type: 'whatsapp_learning_import' as any,
      actor_role: (req as any).actor_role,
      actor_masked_ref: 'safe-token-hash',
      role_resolution_source: (req as any).role_resolution_source,
      target_type: 'system',
      target_safe_ref: batch_ref,
      risk_level: 'MEDIUM',
      confirm_required: true,
      confirmed: true,
      result_status: 'success',
      idempotency_key_hash: key,
      imported_count: imported,
      skipped_duplicate_count: skipped
    });

    return reply.send({ status: 'success', batch_ref, imported_count: imported, skipped_duplicate_count: skipped });
  });

  app.post('/dashboard/actions/whatsapp-learning/generate-suggestions', { preHandler: [requireAuth, checkIdempotency] }, async (req, reply) => {
    if (!deps.whatsappLearningStore || !deps.ingestionStore) return reply.code(500).send({ error: 'Stores not configured' });
    const key = req.headers['x-idempotency-key'] as string | undefined;
    const body = req.body as { confirm?: boolean };
    
    if (!body?.confirm) return reply.code(400).send({ error: 'Confirmation required' });
    if (!key) return reply.code(400).send({ error: 'x-idempotency-key required' });

    let generated_count = 0;
    let skipped_count = 0;
    
    const messages = deps.whatsappLearningStore.listMessages();
    for (const m of messages) {
      if (m.detected_jargon.length === 0 && m.detected_faq.length === 0 && m.detected_objection.length === 0 && m.detected_training_point.length === 0) {
        continue;
      }
      
      let suggestion_class: import("../storage/ingestionTypes.js").IngestionClass = 'unknown';
      if (m.detected_faq.length > 0) suggestion_class = 'general_question' as any;
      else if (m.detected_objection.length > 0) suggestion_class = 'payment_or_trust_question';
      else if (m.detected_training_point.length > 0) suggestion_class = 'training_question';
      else if (m.detected_jargon.length > 0) suggestion_class = 'general_question' as any;
      
      const existing = deps.ingestionStore.listLearningSuggestions();
      const isDup = existing.some(s => s.source_message_safe_ref === m.message_ref);
      
      if (isDup) {
        skipped_count++;
        continue;
      }
      
      deps.ingestionStore.saveLearningSuggestion({
        suggestion_id: 'SUG-WA-' + Date.now() + '-' + Math.random().toString(36).substring(2,8),
        source_job_id: 'whatsapp_learning_gen',
        platform: 'whatsapp',
        suggestion_class,
        evidence_preview_sanitized: m.message_text_sanitized.substring(0, 500),
        proposed_knowledge_type: 'public_faq',
        proposed_text: 'Suggested knowledge from WA History: ' + m.message_text_sanitized.substring(0, 100),
        confidence: 0.85,
        status: 'pending_owner_review',
        created_at: new Date().toISOString(),
        source_type: 'whatsapp_learning_message' as any,
        source_message_safe_ref: m.message_ref,
        source_label_safe: m.source_label_safe,
        import_batch_ref: m.import_batch_ref,
        suggested_category: suggestion_class
      });
      generated_count++;
    }

    deps.actionAuditStore.logAction({
      action_type: 'whatsapp_learning_generate' as any,
      actor_role: (req as any).actor_role,
      actor_masked_ref: 'safe-token-hash',
      role_resolution_source: (req as any).role_resolution_source,
      target_type: 'system',
      target_safe_ref: 'whatsapp_learning_messages',
      risk_level: 'MEDIUM',
      confirm_required: true,
      confirmed: true,
      result_status: 'success',
      idempotency_key_hash: key,
      generated_count,
      skipped_duplicate_count: skipped_count
    });

    return reply.send({ status: 'success', generated_count, skipped_duplicate_count: skipped_count });
  });

  // ==========================================
  // WHATSAPP VISUAL RESEARCH
  // ==========================================

  app.post("/dashboard/actions/whatsapp-visual-research/import", { preHandler: requireAuth }, async (req, reply) => {
    if (!deps.whatsappVisualResearchStore) {
      return reply.code(500).send({ error: "whatsappVisualResearchStore is not initialized" });
    }
    
    // Accept either multipart form data or application/json for local path
    const isMultipart = req.isMultipart();
    
    let sourceLabelSafe = "unknown";
    let mode = "";
    let confirm = false;
    let localPath = "";
    let fileBuffer: Buffer | null = null;
    
    if (isMultipart) {
      const parts = req.parts();
      for await (const part of parts) {
        if (part.type === 'file') {
          if (part.fieldname === 'zip_file') {
            fileBuffer = await part.toBuffer();
          }
        } else {
          if (part.fieldname === 'source_label_safe') sourceLabelSafe = part.value as string;
          if (part.fieldname === 'mode') mode = part.value as string;
          if (part.fieldname === 'confirm') confirm = part.value === 'true' || part.value === true;
        }
      }
    } else {
      const body = req.body as any;
      if (!body) return reply.code(400).send({ error: "Missing body" });
      sourceLabelSafe = body.source_label_safe || "unknown";
      mode = body.mode;
      confirm = body.confirm;
      localPath = body.local_path;
    }

    if (mode !== "research_only") {
      return reply.code(400).send({ error: "Only research_only mode is supported" });
    }
    if (!confirm) {
      return reply.code(400).send({ error: "Confirmation is required" });
    }

    const { processWhatsAppZip } = await import("./whatsappVisualContextProcessor.js");
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");
    const { randomUUID } = await import("node:crypto");

    let zipPathToProcess = localPath;
    let cleanupPath = "";

    try {
      if (fileBuffer) {
        // limit 50MB check is already done by fastify-multipart
        const tempZip = path.join(os.tmpdir(), `upload-${randomUUID()}.zip`);
        fs.writeFileSync(tempZip, fileBuffer);
        zipPathToProcess = tempZip;
        cleanupPath = tempZip;
      } else if (localPath) {
        // Enforce local path is only allowed in debug/owner mode or if flag is set, but user specifies env flag
        if (process.env.ALLOW_LOCAL_ZIP_IMPORT !== "true" && process.env.NODE_ENV !== "test" && process.env.SPEC_SYNTHETIC_MODE !== "true") {
          return reply.code(403).send({ error: "Local path import is disabled in production" });
        }
        if (!fs.existsSync(localPath)) {
          return reply.code(400).send({ error: "Local file does not exist" });
        }
      } else {
        return reply.code(400).send({ error: "No zip_file or local_path provided" });
      }

      await processWhatsAppZip(zipPathToProcess, {
        source_label_safe: sourceLabelSafe.replace(/[^a-zA-Z0-9_\-]/g, "_"),
        store: deps.whatsappVisualResearchStore
      });
      
      deps.actionAuditStore.logAction({
        actor_role: (req as any).actor_role,
        actor_masked_ref: 'safe-token-hash',
        role_resolution_source: (req as any).role_resolution_source,
        action_type: "visual_research_import" as any,
        target_type: "system",
        target_safe_ref: sourceLabelSafe,
        risk_level: "MEDIUM",
        confirm_required: true,
        confirmed: true,
        result_status: "success",
        idempotency_key_hash: "none"
      });

      return reply.send({ success: true, summary: deps.whatsappVisualResearchStore.getSummary() });
    } catch (e: any) {
      return reply.code(400).send({ error: "Failed to process zip", details: e.message });
    } finally {
      if (cleanupPath && fs.existsSync(cleanupPath)) {
        try { fs.unlinkSync(cleanupPath); } catch (_) {}
      }
    }
  });

  app.get("/dashboard/api/whatsapp-visual-research", { preHandler: requireAuth }, async (req, reply) => {
    if (!deps.whatsappVisualResearchStore) {
      return reply.code(500).send({ error: "whatsappVisualResearchStore is not initialized" });
    }
    
    return reply.send({
      summary: deps.whatsappVisualResearchStore.getSummary(),
      items: deps.whatsappVisualResearchStore.listItems()
    });
  });

  app.post("/dashboard/actions/whatsapp-visual-research/:ref/draft-learning", { preHandler: requireAuth }, async (req, reply) => {
    if (!deps.whatsappVisualResearchStore || !deps.ingestionStore) {
      return reply.code(500).send({ error: "Stores not initialized" });
    }

    const itemRef = (req.params as any).ref;
    const items = deps.whatsappVisualResearchStore.listItems();
    const item = items.find(i => i.visual_ref === itemRef);
    if (!item) {
      return reply.code(404).send({ error: "Visual finding not found" });
    }

    const { randomUUID } = await import("node:crypto");
    
    const contextStr = item.nearby_context_sanitized.join(" \\n ");
    const learningSuggestion: import("../storage/ingestionTypes.js").LearningSuggestion = {
      suggestion_id: `SUG-WVR-${randomUUID().substring(0, 8).toUpperCase()}`,
      source_job_id: "visual_research",
      platform: "whatsapp",
      suggestion_class: "general_question" as any,
      status: "pending_owner_review",
      evidence_preview_sanitized: `Context for ${item.visual_category}: ${contextStr}`,
      proposed_knowledge_type: "public_faq",
      proposed_text: `Users commonly encounter the ${item.visual_category} screen with context: ${contextStr}`,
      confidence: item.confidence / 100,
      created_at: new Date().toISOString(),
      source_type: "whatsapp_visual_research",
      source_message_safe_ref: item.visual_ref,
      source_label_safe: item.source_label_safe,
      import_batch_ref: item.import_batch_ref,
      suggested_category: "general_question" as any
    };

    deps.ingestionStore.saveLearningSuggestion(learningSuggestion);
    
    deps.actionAuditStore.logAction({
      actor_role: (req as any).actor_role,
      actor_masked_ref: 'safe-token-hash',
      role_resolution_source: (req as any).role_resolution_source,
      action_type: "visual_research_draft_learning" as any,
      target_type: "system",
      target_safe_ref: item.visual_ref,
      risk_level: "LOW",
      confirm_required: false,
      confirmed: true,
      result_status: "success",
      idempotency_key_hash: "none"
    });

    return reply.send({ success: true, safe_ref: learningSuggestion.suggestion_id });
  });
}