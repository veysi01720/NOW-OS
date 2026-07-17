import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { EnvConfig } from "../config/env.js";
import type { ActionAuditStore, DashboardActionAuditV1 } from "../store/actionAuditStore.js";
import type { ZipIngestionStore } from "./zipIngestion/store.js";
import type { ZipLearningCandidateRecord } from "./zipIngestion/types.js";
import { createApprovedReviewsDryRun, relativeOutputPath } from "./reviewPublishDryRun.js";

export interface ReviewRoutesDeps {
  env: EnvConfig;
  zipIngestionStore: ZipIngestionStore;
  actionAuditStore: ActionAuditStore;
}

type ActorRole = "owner" | "manager";

function sanitizeText(value: string | undefined, maxLength = 1000): string {
  return (value ?? "")
    .replace(/@s\.whatsapp\.net/g, "[jid]")
    .replace(/@g\.us/g, "[group]")
    .replace(/(?<!\d)(?:\+?90|0)?5\d{2}\s?\d{3}\s?\d{2}\s?\d{2}(?!\d)/g, "905***")
    .replace(/<[^>]*>?/gm, "")
    .slice(0, maxLength);
}

function riskFlagsFor(text: string): string[] {
  const flags: string[] = [];
  if (/garanti\s+kazanç|kesin\s+kazan|mutlaka\s+kazan/i.test(text)) flags.push("risky_earnings_claim");
  if (/sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}/i.test(text)) flags.push("secret_like_token");
  if (/(?<!\d)(?:\+?90|0)?5\d{2}\s?\d{3}\s?\d{2}\s?\d{2}(?!\d)/.test(text)) flags.push("raw_phone_detected");
  if (/@s\.whatsapp\.net|@g\.us/.test(text)) flags.push("raw_jid_detected");
  return flags;
}

function conflictFlagsFor(text: string): string[] {
  const flags: string[] = [];
  if (/Linky/i.test(text) && !/M9W5B8/i.test(text)) flags.push("possible_linky_code_conflict");
  if (/Layla/i.test(text) && /iPhone/i.test(text) && !/N[İI]V[İI]/i.test(text)) flags.push("possible_layla_ios_name_conflict");
  return flags;
}

function safeCandidate(candidate: ZipLearningCandidateRecord, detail = false) {
  const risk_flags = candidate.risk_flags ?? riskFlagsFor(candidate.extracted_text);
  const conflict_flags = candidate.conflict_flags ?? conflictFlagsFor(candidate.extracted_text);
  return {
    id: candidate.id,
    source: candidate.source,
    source_job_id: candidate.source_job_id,
    source_entry_id: candidate.source_entry_id,
    candidate_type: candidate.candidate_type,
    status: candidate.status,
    confidence: candidate.confidence,
    created_at: candidate.created_at,
    reviewed_by: candidate.reviewed_by ?? null,
    reviewed_at: candidate.reviewed_at ?? null,
    review_decision: candidate.review_decision ?? null,
    conflict_flags,
    risk_flags,
    recommended_action: candidate.recommended_action ?? (risk_flags.length || conflict_flags.length ? "owner_review_required" : "approve_if_relevant"),
    extracted_text_preview: sanitizeText(candidate.extracted_text, 500),
    ...(detail ? {
      extracted_text_sanitized: sanitizeText(candidate.extracted_text, 5000),
      source_metadata: {
        source_job_id: candidate.source_job_id,
        source_entry_id: candidate.source_entry_id,
        source_type: candidate.source
      },
      conflict_notes: conflict_flags,
      risk_notes: risk_flags,
      owner_decision: {
        status: candidate.status,
        reviewed_by: candidate.reviewed_by ?? null,
        reviewed_at: candidate.reviewed_at ?? null,
        review_note_sanitized: candidate.review_note_sanitized ?? null
      }
    } : {})
  };
}

function requireReviewAuth(deps: ReviewRoutesDeps) {
  return (req: FastifyRequest, reply: FastifyReply, done: () => void) => {
    const authHeader = req.headers["x-dashboard-token"] as string | undefined;
    if (!authHeader) {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }
    const token = authHeader.split(" ")[1] || authHeader;
    let role: ActorRole | null = null;
    let source: DashboardActionAuditV1["role_resolution_source"] = "unknown";

    if (token === deps.env.dashboardOwnerToken && deps.env.dashboardOwnerToken !== "") {
      role = "owner";
      source = "owner_token";
    } else if (token === deps.env.dashboardManagerToken && deps.env.dashboardManagerToken !== "") {
      role = "manager";
      source = "manager_token";
    } else if (token === deps.env.dashboardAdminToken && deps.env.dashboardAdminToken !== "") {
      role = "owner";
      source = "legacy_admin_owner";
    }

    if (process.env.NODE_ENV === "test" && req.headers["x-actor-role"]) {
      role = req.headers["x-actor-role"] as ActorRole;
      source = "test_override";
    }

    if (!role) {
      deps.actionAuditStore.logAction({
        action_type: "review_unauthorized_access",
        actor_role: "unknown",
        actor_masked_ref: "safe-token-hash",
        role_resolution_source: "unknown",
        target_type: "learning",
        target_safe_ref: "review_api",
        risk_level: "MEDIUM",
        confirm_required: false,
        confirmed: false,
        result_status: "failure",
        error_safe_message: "Unauthorized review access"
      });
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }

    (req as any).actor_role = role;
    (req as any).role_resolution_source = source;
    done();
  };
}

export function registerReviewRoutes(app: FastifyInstance, deps: ReviewRoutesDeps): void {
  const auth = requireReviewAuth(deps);

  app.get("/dashboard/review/jobs", { preHandler: auth }, async (_req, reply) => {
    const candidates = deps.zipIngestionStore.listLearningCandidates();
    return reply.send({
      jobs: deps.zipIngestionStore.listJobs().map((job) => {
        const jobCandidates = candidates.filter((candidate) => candidate.source_job_id === job.id);
        const riskCount = jobCandidates.reduce((sum, candidate) => sum + riskFlagsFor(candidate.extracted_text).length, 0);
        const conflictCount = jobCandidates.reduce((sum, candidate) => sum + conflictFlagsFor(candidate.extracted_text).length, 0);
        return {
          id: job.id,
          status: job.status,
          created_at: job.created_at,
          file_count: job.total_entries,
          candidate_count: jobCandidates.length,
          risk_count: riskCount,
          conflict_count: conflictCount,
          original_filename: sanitizeText(job.original_filename, 200),
          sender_masked: job.sender_masked
        };
      })
    });
  });

  app.get("/dashboard/review/jobs/:jobId", { preHandler: auth }, async (req, reply) => {
    const jobId = (req.params as any).jobId as string;
    const job = deps.zipIngestionStore.getJob(jobId);
    if (!job) return reply.code(404).send({ error: "Review job not found" });
    return reply.send({
      job: {
        id: job.id,
        status: job.status,
        created_at: job.created_at,
        updated_at: job.updated_at,
        file_count: job.total_entries,
        accepted_entries: job.accepted_entries,
        rejected_entries: job.rejected_entries,
        candidate_count: deps.zipIngestionStore.listLearningCandidates(job.id).length,
        original_filename: sanitizeText(job.original_filename, 200),
        sender_masked: job.sender_masked
      },
      entries: deps.zipIngestionStore.listEntries(job.id).map((entry) => ({
        id: entry.id,
        sanitized_path: sanitizeText(entry.sanitized_path, 300),
        extension: entry.extension,
        status: entry.status,
        reject_reason: sanitizeText(entry.reject_reason, 300),
        extracted_text_length: entry.extracted_text_length
      })),
      candidates: deps.zipIngestionStore.listLearningCandidates(job.id).map((candidate) => safeCandidate(candidate))
    });
  });

  app.get("/dashboard/review/candidates", { preHandler: auth }, async (req, reply) => {
    const status = (req.query as any).status as string | undefined;
    const candidates = deps.zipIngestionStore
      .listLearningCandidates()
      .filter((candidate) => status ? candidate.status === status : candidate.status === "pending_owner_review");
    return reply.send({ candidates: candidates.map((candidate) => safeCandidate(candidate)) });
  });

  app.get("/dashboard/review/candidates/:candidateId", { preHandler: auth }, async (req, reply) => {
    const candidate = deps.zipIngestionStore.getLearningCandidate((req.params as any).candidateId);
    if (!candidate) return reply.code(404).send({ error: "Review candidate not found" });
    return reply.send({ candidate: safeCandidate(candidate, true) });
  });

  app.post("/dashboard/review/candidates/:candidateId/decision", { preHandler: auth }, async (req, reply) => {
    const key = req.headers["x-idempotency-key"] as string | undefined;
    const keyHash = key ? createHash("sha256").update(key).digest("hex") : undefined;
    if (keyHash && deps.actionAuditStore.hasIdempotencyKey(keyHash)) {
      return reply.send({ status: "skipped_duplicate" });
    }

    const body = req.body as { decision?: "approve" | "reject" | "needs_edit"; note?: string; confirm?: boolean };
    if (!body?.confirm) return reply.code(400).send({ error: "Confirmation required" });
    if (!body.decision || !["approve", "reject", "needs_edit"].includes(body.decision)) {
      return reply.code(400).send({ error: "Invalid decision" });
    }

    const candidateId = (req.params as any).candidateId as string;
    const existing = deps.zipIngestionStore.getLearningCandidate(candidateId);
    if (!existing) return reply.code(404).send({ error: "Review candidate not found" });
    const previousStatus = existing.status;
    const updated = deps.zipIngestionStore.reviewLearningCandidate(
      candidateId,
      body.decision,
      (req as any).actor_role,
      sanitizeText(body.note, 500)
    );
    if (!updated) return reply.code(404).send({ error: "Review candidate not found" });

    deps.actionAuditStore.logAction({
      action_type: `zip_review_${body.decision}`,
      actor_role: (req as any).actor_role,
      actor_masked_ref: "safe-token-hash",
      role_resolution_source: (req as any).role_resolution_source,
      target_type: "learning",
      target_safe_ref: candidateId,
      risk_level: body.decision === "approve" ? "HIGH" : "MEDIUM",
      confirm_required: true,
      confirmed: true,
      result_status: "success",
      idempotency_key_hash: keyHash,
      previous_status: previousStatus,
      new_status: updated.status,
      sanitized_reason: sanitizeText(body.note, 250)
    });

    return reply.send({
      status: "success",
      candidate: safeCandidate(updated, true),
      publish_triggered: false,
      vector_modified: false,
      active_knowledge_modified: false
    });
  });

  app.post("/dashboard/review/dry-run-bundle", { preHandler: auth }, async (req, reply) => {
    const body = req.body as { confirm?: boolean } | undefined;
    if (!body?.confirm) return reply.code(400).send({ error: "Confirmation required" });
    let result: ReturnType<typeof createApprovedReviewsDryRun>;
    try {
      result = createApprovedReviewsDryRun({ zipStore: deps.zipIngestionStore });
    } catch (error) {
      return reply.code(500).send({
        error: "Dry-run bundle creation failed",
        safe_message: error instanceof Error ? error.message : String(error)
      });
    }
    deps.actionAuditStore.logAction({
      action_type: "zip_review_dry_run_bundle",
      actor_role: (req as any).actor_role,
      actor_masked_ref: "safe-token-hash",
      role_resolution_source: (req as any).role_resolution_source,
      target_type: "learning",
      target_safe_ref: result.dry_run_id,
      risk_level: "MEDIUM",
      confirm_required: true,
      confirmed: true,
      result_status: "success",
      new_status: result.manifest.ready_for_owner_publish_approval ? "ready_for_owner_publish_approval" : "dry_run_created"
    });
    return reply.send({
      status: "dry_run_created",
      dry_run_id: result.dry_run_id,
      output_path: relativeOutputPath(result.output_dir),
      manifest_path: relativeOutputPath(result.manifest_path),
      bundle_hash: result.bundle_hash,
      manifest: result.manifest,
      openai_publish_triggered: false,
      vector_modified: false,
      active_knowledge_modified: false
    });
  });
}
