import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { logger } from "../observability/logger.js";
import type { PersistentIngestionStore } from "../storage/ingestionStore.js";
import type { PublishJob, PublishJobStatus } from "../storage/ingestionTypes.js";
import { uploadKnowledgeFile, attachFileToVectorStore, waitForVectorStoreFileCompleted, type PublishResult } from "./openaiFileSearchPublisher.js";
import type { EnvConfig } from "../config/env.js";
import type { KnowledgePublishContext } from "../contracts/backendContextPayload.js";
import type { SenderRole } from "../config/roles.js";

function knowledgeBankDir(): string {
  return process.env.KNOWLEDGE_BANK_DIR
    ? resolve(process.env.KNOWLEDGE_BANK_DIR)
    : resolve(process.cwd(), "data", "knowledge_bank");
}

function jsonTarget(): string {
  return resolve(knowledgeBankDir(), "approved_learning.json");
}

function mdTarget(): string {
  return resolve(knowledgeBankDir(), "approved_learning.md");
}

export function detectKnowledgePublishIntent(text: string): string | null {
  const normalized = text.toLowerCase().trim();
  if (normalized.includes("bilgi bankası yayın durumu") || normalized.includes("publish durumu")) return "check_publish_status";
  if (normalized.includes("bilgi bankasını yayınla") || normalized.includes("knowledge publish")) return "publish_local_knowledge";
  if (normalized.includes("file search güncelleme durumu")) return "check_publish_status";
  if (normalized.includes("file search yenile") || normalized.includes("vector store yenile")) return "publish_local_knowledge";
  if (normalized.includes("assistant knowledge refresh")) return "publish_local_knowledge";
  if (normalized.includes("son publish durumu")) return "check_publish_status";
  if (normalized.includes("duplicate publish atla")) return "skip_duplicate_publish";
  return null;
}

export function computeSourceHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function validatePublishSourceSafety(content: string): { is_safe: boolean; reason?: string } {
  const phonePattern = /(?<!\d)(?:\+90|0)?5\d{2}\s?\d{3}\s?\d{2}\s?\d{2}(?!\d)/;
  const ibanPattern = /TR[a-zA-Z0-9]{22}/i;
  const cardPattern = /(?:\d[ -]*?){13,16}/;
  const tokenPattern = /(sk-[a-zA-Z0-9]{20,}|Bearer\s+[a-zA-Z0-9\-\._~+\/]+=*)/i;
  const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const openaiIdPattern = /(file-[a-zA-Z0-9]{24}|vs_[a-zA-Z0-9]{24}|asst_[a-zA-Z0-9]{24})/i;

  if (tokenPattern.test(content)) return { is_safe: false, reason: "Contains potential API Key or Token." };
  if (phonePattern.test(content)) return { is_safe: false, reason: "Contains potential full phone number." };
  if (ibanPattern.test(content)) return { is_safe: false, reason: "Contains potential IBAN." };
  if (cardPattern.test(content)) return { is_safe: false, reason: "Contains potential Credit Card number." };
  if (uuidPattern.test(content)) return { is_safe: false, reason: "Contains raw UUID (suggestion_id internal leak)." };
  if (openaiIdPattern.test(content)) return { is_safe: false, reason: "Contains raw OpenAI ID." };

  return { is_safe: true };
}

export function maskOpenAIId(id: string): string {
  if (id.startsWith("file-")) return `file-***${id.substring(id.length - 4)}`;
  if (id.startsWith("vs_")) return `vs_***${id.substring(id.length - 4)}`;
  if (id.startsWith("asst_")) return `asst_***${id.substring(id.length - 4)}`;
  return `***${id.substring(id.length - 4)}`;
}

export function appendKnowledgePublishAudit(
  action: string,
  actorRole: string,
  publishJobId: string | undefined,
  previousStatus: PublishJobStatus | undefined,
  newStatus: PublishJobStatus,
  result: "success" | "failure" | "skipped",
  sourceHashMasked?: string,
  sanitizedError?: string
): void {
  logger.info({
    event_type: "KNOWLEDGE_PUBLISH_AUDIT",
    action,
    actor_role: actorRole,
    publish_job_id: publishJobId,
    previous_status: previousStatus,
    new_status: newStatus,
    timestamp: new Date().toISOString(),
    result,
    source_hash_masked: sourceHashMasked,
    sanitized_error: sanitizedError
  });
}

function getActiveSource(): { path: string; content: string } | null {
  const md = mdTarget();
  const json = jsonTarget();
  if (existsSync(md)) return { path: md, content: readFileSync(md, "utf-8") };
  if (existsSync(json)) return { path: json, content: readFileSync(json, "utf-8") };
  return null;
}

export async function publishLocalKnowledgeToOpenAI(
  env: EnvConfig,
  store: PersistentIngestionStore,
  actorRole: string
): Promise<PublishResult> {
  const source = getActiveSource();
  if (!source) {
    appendKnowledgePublishAudit("publish_local_knowledge", actorRole, undefined, undefined, "failed", "failure", undefined, "No source file found.");
    return { success: false, mode: "mock", real_openai_publish: false, message: "No local knowledge bank source found." };
  }

  const hash = computeSourceHash(source.content);
  const hashMasked = `${hash.substring(0, 4)}***${hash.substring(hash.length - 4)}`;

  const safety = validatePublishSourceSafety(source.content);
  if (!safety.is_safe) {
    appendKnowledgePublishAudit("publish_local_knowledge", actorRole, undefined, undefined, "failed", "failure", hashMasked, safety.reason);
    return { success: false, mode: env.realOpenaiPublishEnabled ? "real" : "mock", real_openai_publish: false, message: "Safety scan failed.", sanitized_error: safety.reason };
  }

  if (env.realOpenaiPublishEnabled) {
     if (!env.openaiApiKey) {
        appendKnowledgePublishAudit("publish_local_knowledge", actorRole, undefined, undefined, "failed", "failure", hashMasked, "Missing OPENAI_API_KEY");
        return { success: false, mode: "real", real_openai_publish: true, message: "Missing OPENAI_API_KEY", sanitized_error: "Missing API Key" };
     }
     if (!env.openaiVectorStoreId) {
        appendKnowledgePublishAudit("publish_local_knowledge", actorRole, undefined, undefined, "failed", "failure", hashMasked, "Missing OPENAI_VECTOR_STORE_ID");
        return { success: false, mode: "real", real_openai_publish: true, message: "Missing OPENAI_VECTOR_STORE_ID", sanitized_error: "Missing Vector Store ID" };
     }
  }

  const jobs = store.listPublishJobs().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const lastCompleted = jobs.find(j => j.publish_status === "completed");

  if (lastCompleted && lastCompleted.source_hash === hash) {
    appendKnowledgePublishAudit("publish_local_knowledge", actorRole, undefined, undefined, "skipped", "skipped", hashMasked, "Duplicate source hash.");
    return { success: true, mode: "mock", real_openai_publish: false, message: "Source hash matches last completed publish. Skipping duplicate publish." };
  }

  const jobId = `PUB-${Date.now()}`;
  const newJob: PublishJob = {
    publish_job_id: jobId,
    source_target: source.path,
    source_hash: hash,
    publish_status: "running",
    publish_mode: "mock",
    created_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    actor_role: actorRole
  };

  store.savePublishJob(newJob);
  appendKnowledgePublishAudit("publish_local_knowledge", actorRole, jobId, undefined, "running", "success", hashMasked);

  const realConfigPresent = !!(env.openaiApiKey && env.openaiAssistantId);

  // Upload step
  const uploadResult = await uploadKnowledgeFile(source.path, env);
  newJob.publish_mode = uploadResult.mode;
  if (!uploadResult.success) {
    newJob.publish_status = "failed";
    newJob.sanitized_error_if_any = uploadResult.sanitized_error;
    store.savePublishJob(newJob);
    appendKnowledgePublishAudit("publish_local_knowledge", actorRole, jobId, "running", "failed", "failure", hashMasked, uploadResult.sanitized_error);
    return uploadResult;
  }
  newJob.openai_file_id_masked = uploadResult.openai_file_id_masked;

  // Attach step
  const attachResult = await attachFileToVectorStore(uploadResult._raw_openai_file_id || uploadResult.openai_file_id_masked!, env);
  if (!attachResult.success) {
    newJob.publish_status = "failed";
    newJob.sanitized_error_if_any = attachResult.sanitized_error;
    store.savePublishJob(newJob);
    appendKnowledgePublishAudit("publish_local_knowledge", actorRole, jobId, "running", "failed", "failure", hashMasked, attachResult.sanitized_error);
    return attachResult;
  }
  newJob.vector_store_id_masked = attachResult.vector_store_id_masked;

  // Wait for completed
  const waitResult = await waitForVectorStoreFileCompleted(uploadResult._raw_openai_file_id || uploadResult.openai_file_id_masked!, env);
  if (!waitResult.success) {
    newJob.publish_status = "failed";
    newJob.sanitized_error_if_any = waitResult.sanitized_error;
    store.savePublishJob(newJob);
    appendKnowledgePublishAudit("publish_local_knowledge", actorRole, jobId, "running", "failed", "failure", hashMasked, waitResult.sanitized_error);
    return waitResult;
  }

  newJob.publish_status = "completed";
  newJob.completed_at = new Date().toISOString();
  newJob.published_file_hash = hash;
  newJob.audit_note = `real_config_present: ${realConfigPresent}`;
  store.savePublishJob(newJob);

  appendKnowledgePublishAudit("publish_local_knowledge", actorRole, jobId, "running", "completed", "success", hashMasked);

  return {
    success: true,
    mode: uploadResult.mode,
    real_openai_publish: uploadResult.real_openai_publish,
    message: uploadResult.mode === "mock" ? "Mock publish completed. Real OpenAI File Search was not updated." : "Real publish completed successfully.",
    openai_file_id_masked: uploadResult.openai_file_id_masked,
    vector_store_id_masked: attachResult.vector_store_id_masked
  };
}

export function buildKnowledgePublishContext(
  intent: string,
  role: SenderRole,
  store: PersistentIngestionStore,
  env: EnvConfig
): KnowledgePublishContext {
  const jobs = store.listPublishJobs().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const lastJob = jobs[0];
  const lastCompleted = jobs.find(j => j.publish_status === "completed");

  const source = getActiveSource();
  let currentHashMasked = "none";
  let publishNeeded = false;
  let safetyStatus = "NOT_CHECKED";
  let sourceVersion = "v1.0";
  let itemCount = 0;

  if (source) {
    const hash = computeSourceHash(source.content);
    currentHashMasked = `${hash.substring(0, 4)}***${hash.substring(hash.length - 4)}`;
    const safety = validatePublishSourceSafety(source.content);
    safetyStatus = safety.is_safe ? "PASS" : "FAIL";
    
    if (safety.is_safe && (!lastCompleted || lastCompleted.source_hash !== hash)) {
      publishNeeded = true;
    }

    if (source.path.endsWith(".json")) {
       try {
         const d = JSON.parse(source.content);
         itemCount = Array.isArray(d) ? d.length : 0;
       } catch { /* ignore */ }
    } else {
       itemCount = (source.content.match(/^## \[KB-/gm) || []).length;
    }
  }

  return {
    publish_ready: !!source && safetyStatus === "PASS",
    current_source_hash_masked: currentHashMasked,
    last_published_hash_masked: lastCompleted ? `${lastCompleted.source_hash.substring(0, 4)}***${lastCompleted.source_hash.substring(lastCompleted.source_hash.length - 4)}` : "none",
    publish_needed: publishNeeded,
    last_publish_status: lastJob ? lastJob.publish_status : "none",
    latest_publish_activity_at: lastJob ? lastJob.created_at : undefined,
    publish_preview: {
      source_target: source ? source.path : "none",
      source_version: sourceVersion,
      sanitized_item_count: itemCount,
      source_hash_masked: currentHashMasked,
      safety_scan_status: safetyStatus,
      publish_needed: publishNeeded
    },
    allowed_actions: ["preview_publish", "publish_local_knowledge", "check_publish_status", "skip_duplicate_publish"],
    data_quality_notes: [
      "real_config_present: " + !!(env.openaiApiKey && env.openaiAssistantId),
      "mock_publish_available: true",
      "real_publish_available: false"
    ]
  };
}
