// @ts-nocheck
import AdmZip from "adm-zip";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import type { EnvConfig } from "../../config/env.js";
import type { Logger } from "../../observability/logger.js";
import type { PersistentIngestionStore } from "../../storage/ingestionStore.js";
import type { IngestionClass } from "../../storage/ingestionTypes.js";
import { redactSecrets } from "../../utils/redaction.js";
import type { NormalizedIncomingMessage } from "../normalizeEvolutionMessage.js";
import { downloadEvolutionMedia } from "./mediaDownloader.js";
import { ZipIngestionStore } from "./store.js";
import type {
  ZipEntryStatus,
  ZipIngestionEntryRecord,
  ZipIngestionJobRecord,
  ZipIngestionLimits,
  ZipIngestionManifest,
  ZipLearningCandidateRecord,
  ZipLearningCandidateType,
  ZipProcessResult
} from "./types.js";

export const DEFAULT_ZIP_LIMITS: ZipIngestionLimits = {
  maxZipBytes: 50 * 1024 * 1024,
  maxFiles: 500,
  maxExtractedBytes: 200 * 1024 * 1024,
  maxEntryBytes: 10 * 1024 * 1024,
  processTimeoutSeconds: 180
};

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".json", ".csv", ".html", ".htm"]);
const METADATA_ONLY_EXTENSIONS = new Set([".pdf", ".docx", ".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov", ".mp3", ".wav"]);
const UNSAFE_BINARY_EXTENSIONS = new Set([".exe", ".apk", ".bat", ".cmd", ".ps1", ".sh", ".dll", ".msi", ".scr", ".jar"]);

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 3 ? `${digits.slice(0, 3)}***` : "***";
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function safePreview(text: string, maxLength = 500): string {
  return redactSecrets(text).replace(/<[^>]*>?/gm, "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function classifyText(text: string): { candidateType: ZipLearningCandidateType; suggestionClass: IngestionClass; proposedType: string; confidence: number } {
  const lower = text.toLowerCase();
  if (/https?:\/\/|link|url/.test(lower)) {
    return { candidateType: "link_candidate", suggestionClass: "unknown", proposedType: "link_candidate", confidence: 0.55 };
  }
  if (/(kod|davet|ajans|layla|soyo|amar|timo|linky|nivi)/i.test(text)) {
    return { candidateType: "app_fact_candidate", suggestionClass: "unknown", proposedType: "app_fact_candidate", confidence: 0.7 };
  }
  if (/(soru|cevap|sss|faq|\?)/i.test(text)) {
    return { candidateType: "faq_candidate", suggestionClass: "training_question", proposedType: "faq_candidate", confidence: 0.65 };
  }
  if (/(adim|adım|kurulum|once|sonra|egitim|eğitim)/i.test(text)) {
    return { candidateType: "workflow_candidate", suggestionClass: "training_question", proposedType: "workflow_candidate", confidence: 0.68 };
  }
  if (/(patron|dayi|dayı|şef|sef|dil|uslup|üslup)/i.test(text)) {
    return { candidateType: "style_rule_candidate", suggestionClass: "unknown", proposedType: "style_rule_candidate", confidence: 0.6 };
  }
  if (/(operator|operatör|destek|eskale|yonetici|yönetici)/i.test(text)) {
    return { candidateType: "escalation_rule_candidate", suggestionClass: "support_signal", proposedType: "escalation_rule_candidate", confidence: 0.62 };
  }
  return { candidateType: "raw_reference", suggestionClass: "unknown", proposedType: "raw_reference", confidence: 0.5 };
}

export function isUnsafeZipEntryPath(entryName: string): boolean {
  const raw = entryName.replaceAll("\\", "/");
  const normalized = normalize(entryName).replaceAll("\\", "/");
  return (
    isAbsolute(entryName) ||
    raw.startsWith("../") ||
    raw.includes("/../") ||
    raw === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized === ".." ||
    entryName.includes("\0")
  );
}

function isSymlink(entry: AdmZip.IZipEntry): boolean {
  const attr = (entry.header as unknown as { attr?: number }).attr ?? 0;
  const unixMode = (attr >>> 16) & 0o170000;
  return unixMode === 0o120000;
}

function isEncrypted(entry: AdmZip.IZipEntry): boolean {
  return ((entry.header.flags ?? 0) & 0x1) === 0x1;
}

function rejectEntry(jobId: string, entryName: string, reason: string, size = 0): ZipIngestionEntryRecord {
  const extension = extname(entryName).toLowerCase();
  return {
    id: `zie_${randomUUID()}`,
    job_id: jobId,
    original_path: entryName,
    sanitized_path: basename(entryName),
    extension,
    mime_guess: guessMime(extension),
    size_bytes: size,
    sha256: "",
    status: "rejected",
    reject_reason: reason,
    extracted_text_length: 0,
    parser_used: "none"
  };
}

function guessMime(extension: string): string {
  const map: Record<string, string> = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".csv": "text/csv",
    ".html": "text/html",
    ".htm": "text/html",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav"
  };
  return map[extension] ?? "application/octet-stream";
}

export function loadZipLimitsFromEnv(): ZipIngestionLimits {
  return {
    maxZipBytes: Number(process.env.ZIP_MAX_BYTES ?? DEFAULT_ZIP_LIMITS.maxZipBytes),
    maxFiles: Number(process.env.ZIP_MAX_FILES ?? DEFAULT_ZIP_LIMITS.maxFiles),
    maxExtractedBytes: Number(process.env.ZIP_MAX_EXTRACTED_BYTES ?? DEFAULT_ZIP_LIMITS.maxExtractedBytes),
    maxEntryBytes: Number(process.env.ZIP_MAX_ENTRY_BYTES ?? DEFAULT_ZIP_LIMITS.maxEntryBytes),
    processTimeoutSeconds: Number(process.env.ZIP_PROCESS_TIMEOUT_SECONDS ?? DEFAULT_ZIP_LIMITS.processTimeoutSeconds)
  };
}

export async function runZipIngestionJob(input: {
  message: NormalizedIncomingMessage;
  senderRole: "owner" | "manager";
  env: EnvConfig;
  zipStore: ZipIngestionStore;
  ingestionStore?: PersistentIngestionStore;
  logger: Logger;
  limits?: ZipIngestionLimits;
  dataDir?: string;
  zipBuffer?: Buffer;
}): Promise<ZipProcessResult> {
  const limits = input.limits ?? loadZipLimitsFromEnv();
  const attachment = input.message.media;

  let zipBuffer = input.zipBuffer;
  if (!zipBuffer) {
    if (!attachment) {
      throw new Error("ZIP_ATTACHMENT_MISSING");
    }
    const downloaded = await downloadEvolutionMedia({
      attachment,
      env: input.env,
      timeoutMs: Math.min(limits.processTimeoutSeconds * 1000, 30_000),
      maxRetries: 2,
      maxBytes: limits.maxZipBytes
    });
    zipBuffer = downloaded.buffer;
  }
  
  const zipHash = sha256(zipBuffer);
  const now = new Date().toISOString();
  const dataRoot = input.dataDir ?? resolve("data");
  const jobId = `zip_${randomUUID()}`;
  const jobDir = resolve(dataRoot, "zip_ingestion", jobId);
  const extractDir = join(jobDir, "extracted");
  const manifestPath = join(jobDir, "manifest.json");
  mkdirSync(extractDir, { recursive: true });

  const duplicate = input.zipStore.findJobBySha256(zipHash);
  const baseJob: ZipIngestionJobRecord = {
    id: jobId,
    created_at: now,
    updated_at: now,
    sender_role: input.senderRole,
    sender_masked: maskPhone(input.message.phone_number),
    source_channel: "whatsapp",
    source_instance: input.env.evolutionInstance,
    original_filename: attachment.file_name || "upload.zip",
    zip_sha256: zipHash,
    zip_size_bytes: zipBuffer.length,
    status: duplicate ? "duplicate" : "running",
    status_reason: duplicate ? "duplicate_zip_sha256" : "processing",
    total_entries: 0,
    accepted_entries: 0,
    rejected_entries: 0,
    extracted_text_records: 0,
    media_records: 0,
    duplicate_of_job_id: duplicate?.id ?? null,
    manifest_path: manifestPath,
    approved_for_review: false
  };

  if (duplicate) {
    const manifest = buildManifest(baseJob, [], [], ["duplicate_zip_sha256"]);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    input.zipStore.saveJob(baseJob);
    return { job: baseJob, entries: [], candidates: [], manifest };
  }

  input.zipStore.saveJob(baseJob);
  writeFileSync(join(jobDir, "source.zip"), zipBuffer);

  const entries: ZipIngestionEntryRecord[] = [];
  const candidates: ZipLearningCandidateRecord[] = [];
  const safetyFlags: string[] = [];
  const seenHashes = new Set<string>();
  let totalExtracted = 0;

  try {
    const zip = new AdmZip(zipBuffer);
    const zipEntries = zip.getEntries().filter((entry) => !entry.isDirectory);
    if (zipEntries.length > limits.maxFiles) {
      throw new Error("TOO_MANY_FILES");
    }

    for (const entry of zipEntries) {
      const originalPath = entry.entryName;
      const extension = extname(originalPath).toLowerCase();
      const size = entry.header.size ?? 0;

      let rejectReason = "";
      if (isUnsafeZipEntryPath(originalPath)) rejectReason = "unsafe_path";
      else if (originalPath.split(/[/\\]/).length > 10) rejectReason = "nesting_depth_exceeded";
      else if (isSymlink(entry)) rejectReason = "symlink_rejected";
      else if (isEncrypted(entry)) rejectReason = "encrypted_zip_rejected";
      else if (extension === ".zip") rejectReason = "nested_zip_rejected";
      else if (UNSAFE_BINARY_EXTENSIONS.has(extension)) rejectReason = "unsafe_binary_rejected";
      else if (size > limits.maxEntryBytes) rejectReason = "entry_too_large";
      else if (totalExtracted + size > limits.maxExtractedBytes) rejectReason = "extracted_size_limit";

      if (rejectReason) {
        safetyFlags.push(rejectReason);
        const rejected = rejectEntry(jobId, originalPath, rejectReason, size);
        entries.push(rejected);
        input.zipStore.saveEntry(rejected);
        continue;
      }

      const targetPath = resolve(extractDir, originalPath);
      const rel = relative(extractDir, targetPath);
      if (rel.startsWith("..") || rel.includes(`..${sep}`) || isAbsolute(rel)) {
        safetyFlags.push("zip_slip_blocked");
        const rejected = rejectEntry(jobId, originalPath, "zip_slip_blocked", size);
        entries.push(rejected);
        input.zipStore.saveEntry(rejected);
        continue;
      }

      const data = entry.getData();
      totalExtracted += data.length;
      const entryHash = sha256(data);
      
      if (seenHashes.has(entryHash)) {
        safetyFlags.push("duplicate_file");
        const rejected = rejectEntry(jobId, originalPath, "duplicate_file", size);
        entries.push(rejected);
        input.zipStore.saveEntry(rejected);
        continue;
      }
      seenHashes.add(entryHash);

      let status: ZipEntryStatus = "accepted";
      let parser = "none";
      let text = "";
      let reject = "";
      if (TEXT_EXTENSIONS.has(extension)) {
        text = safePreview(data.toString("utf8"), 20_000);
        parser = "utf8_text";
        if (text.trim().length === 0) {
          status = "rejected";
          reject = "empty_content";
          safetyFlags.push("empty_content");
        }
      } else if (METADATA_ONLY_EXTENSIONS.has(extension)) {
        status = "metadata_only";
        parser = "metadata_only";
      } else {
        status = "rejected";
        reject = "unsupported_extension";
        safetyFlags.push("unsupported_extension");
      }

      const sanitizedPath = normalize(originalPath).replaceAll("\\", "/");
      const record: ZipIngestionEntryRecord = {
        id: `zie_${randomUUID()}`,
        job_id: jobId,
        original_path: originalPath,
        sanitized_path: sanitizedPath,
        extension,
        mime_guess: guessMime(extension),
        size_bytes: data.length,
        sha256: entryHash,
        status,
        reject_reason: reject,
        extracted_text_length: text.length,
        parser_used: parser
      };
      entries.push(record);
      input.zipStore.saveEntry(record);

      if (status === "accepted" && text.length > 0) {
        const classification = classifyText(text);
        const candidate: ZipLearningCandidateRecord = {
          id: `zlc_${randomUUID()}`,
          source: "zip_ingestion",
          source_job_id: jobId,
          source_entry_id: record.id,
          candidate_type: classification.candidateType,
          extracted_text: text,
          status: "pending_owner_review",
          confidence: classification.confidence,
          created_at: new Date().toISOString(),
          approved_by: null,
          approved_at: null
        };
        candidates.push(candidate);
        input.zipStore.saveLearningCandidate(candidate);
        input.ingestionStore?.saveLearningSuggestion({
          suggestion_id: `SUG-ZIP-${randomUUID().slice(0, 8).toUpperCase()}`,
          source_job_id: jobId,
          platform: "whatsapp",
          suggestion_class: classification.suggestionClass,
          evidence_preview_sanitized: safePreview(text, 500),
          proposed_knowledge_type: classification.proposedType,
          proposed_text: text,
          confidence: classification.confidence,
          status: "pending_owner_review",
          created_at: new Date().toISOString(),
          source_type: "zip_ingestion",
          source_message_safe_ref: record.id,
          source_label_safe: baseJob.original_filename,
          import_batch_ref: jobId,
          suggested_category: classification.candidateType
        });
      }
    }

    const completed: ZipIngestionJobRecord = {
      ...baseJob,
      status: "completed",
      status_reason: "completed_pending_owner_review",
      updated_at: new Date().toISOString(),
      total_entries: entries.length,
      accepted_entries: entries.filter((entry) => entry.status === "accepted").length,
      rejected_entries: entries.filter((entry) => entry.status === "rejected").length,
      extracted_text_records: entries.filter((entry) => entry.extracted_text_length > 0).length,
      media_records: entries.filter((entry) => entry.status === "metadata_only").length,
      approved_for_review: true
    };
    const manifest = buildManifest(completed, entries, candidates, safetyFlags);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    input.zipStore.saveJob(completed);
    input.logger.info({
      event_type: "ZIP_INGESTION_COMPLETED",
      job_id: completed.id,
      sender_role: completed.sender_role,
      total_entries: completed.total_entries,
      candidate_count: candidates.length
    });
    return { job: completed, entries, candidates, manifest };
  } catch (error) {
    const failed: ZipIngestionJobRecord = {
      ...baseJob,
      status: "failed",
      status_reason: redactSecrets(error instanceof Error ? error.message : String(error)),
      updated_at: new Date().toISOString(),
      total_entries: entries.length,
      accepted_entries: entries.filter((entry) => entry.status === "accepted").length,
      rejected_entries: entries.filter((entry) => entry.status === "rejected").length,
      extracted_text_records: entries.filter((entry) => entry.extracted_text_length > 0).length,
      media_records: entries.filter((entry) => entry.status === "metadata_only").length
    };
    const manifest = buildManifest(failed, entries, candidates, [...safetyFlags, failed.status_reason]);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    input.zipStore.saveJob(failed);
    throw error;
  } finally {
    rmSync(extractDir, { recursive: true, force: true });
  }
}

function buildManifest(
  job: ZipIngestionJobRecord,
  entries: ZipIngestionEntryRecord[],
  candidates: ZipLearningCandidateRecord[],
  safetyFlags: string[]
): ZipIngestionManifest {
  const reject_reasons_summary: Record<string, number> = {};
  for (const entry of entries) {
    if (entry.reject_reason) {
      reject_reasons_summary[entry.reject_reason] = (reject_reasons_summary[entry.reject_reason] ?? 0) + 1;
    }
  }
  return {
    job_id: job.id,
    original_filename: job.original_filename,
    zip_sha256: job.zip_sha256,
    created_at: job.created_at,
    sender_role: job.sender_role,
    source_instance: job.source_instance,
    total_entries: job.total_entries,
    accepted_entries: job.accepted_entries,
    rejected_entries: job.rejected_entries,
    reject_reasons_summary,
    extracted_text_records: job.extracted_text_records,
    media_records: job.media_records,
    candidate_count: candidates.length,
    duplicate_detected: job.status === "duplicate",
    safety_flags: [...new Set(safetyFlags)],
    knowledge_modified: false,
    vector_modified: false,
    publish_triggered: false,
    status: job.status
  };
}
