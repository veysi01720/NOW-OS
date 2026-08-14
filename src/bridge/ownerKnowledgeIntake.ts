import { createHash, randomUUID } from "node:crypto";
import { basename, extname } from "node:path";
import type { Logger } from "../observability/logger.js";
import type { ZipIngestionStore } from "./zipIngestion/store.js";
import { classifyText, sectionMetadata } from "./zipIngestion/pipeline.js";
import type { ZipIngestionEntryRecord, ZipIngestionJobRecord, ZipLearningCandidateRecord, ZipProcessResult } from "./zipIngestion/types.js";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function splitSections(text: string): Array<{ title: string; content: string }> {
  const matches = [...text.matchAll(/^#{1,3}\s+([^\r\n]+)\s*$/gm)];
  if (matches.length === 0) return [{ title: "Owner direct bilgi", content: text.trim() }];
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? text.length;
    const content = text.slice(start, end).trim();
    return { title: match[1].trim(), content };
  }).filter((section) => section.content.length > 0);
}

export function buildZipIngestionOutcomeReply(
  senderRole: "owner" | "manager",
  result: Pick<ZipProcessResult, "job" | "entries" | "candidates">,
): string {
  const address = senderRole === "owner" ? "Patron" : "Dayi";
  if (result.job.status === "duplicate") {
    return "Bu arsiv daha once islendi, yeni bolum bulunamadi. Aktif bilgi degistirilmedi.";
  }
  if (result.job.status === "failed") {
    return "ZIP islenemedi; aktif bilgi degistirilmedi. Inceleme kaydi olusturulmadi.";
  }
  if (result.candidates.length === 0) {
    return `${address} ZIP islendi ancak incelemeye alinabilecek bolum bulunamadi; aktif bilgi degistirilmedi.`;
  }
  return `${result.candidates.length} bolum tespit edildi, owner onayini bekliyor. Aktif bilgi degistirilmedi.`;
}

export interface DirectOwnerKnowledgeResult {
  status: "created" | "duplicate" | "rejected";
  result?: ZipProcessResult;
  error_code?: "DIRECT_TEXT_EMPTY" | "DIRECT_TEXT_NOT_MEANINGFUL";
}

export function createDirectOwnerKnowledgeReview(input: {
  text: string;
  senderRole: "owner" | "manager";
  senderPhone: string;
  sourceInstance: string;
  zipStore: ZipIngestionStore;
  logger?: Logger;
}): DirectOwnerKnowledgeResult {
  const text = input.text.trim();
  if (!text) return { status: "rejected", error_code: "DIRECT_TEXT_EMPTY" };
  const meaningful = text.replace(/[^\p{L}\p{N}]/gu, "").length >= 3;
  if (!meaningful) return { status: "rejected", error_code: "DIRECT_TEXT_NOT_MEANINGFUL" };

  const sourceHash = sha256(text);
  const duplicate = input.zipStore.findJobBySha256(sourceHash);
  const now = new Date().toISOString();
  const jobId = `owner_text_${randomUUID()}`;
  const manifestPath = `data/zip_ingestion/${jobId}/manifest.json`;
  const sections = splitSections(text);
  const job: ZipIngestionJobRecord = {
    id: jobId,
    created_at: now,
    updated_at: now,
    sender_role: input.senderRole,
    sender_masked: `${input.senderPhone.replace(/\D/g, "").slice(0, 3)}***`,
    source_channel: "whatsapp",
    source_instance: input.sourceInstance,
    original_filename: "owner-direct-text.md",
    zip_sha256: sourceHash,
    zip_size_bytes: Buffer.byteLength(text, "utf8"),
    status: duplicate ? "duplicate" : "completed",
    status_reason: duplicate ? "duplicate_direct_text_sha256" : "completed_pending_owner_review",
    total_entries: duplicate ? 0 : sections.length,
    accepted_entries: duplicate ? 0 : sections.length,
    rejected_entries: 0,
    extracted_text_records: duplicate ? 0 : sections.length,
    media_records: 0,
    duplicate_of_job_id: duplicate?.id ?? null,
    manifest_path: manifestPath,
    approved_for_review: !duplicate,
  };
  input.zipStore.saveJob(job);
  if (duplicate) {
    return { status: "duplicate", result: { job, entries: [], candidates: [], manifest: { job_id: job.id, original_filename: job.original_filename, zip_sha256: sourceHash, created_at: now, sender_role: input.senderRole, source_instance: input.sourceInstance, total_entries: 0, accepted_entries: 0, rejected_entries: 0, reject_reasons_summary: {}, extracted_text_records: 0, media_records: 0, candidate_count: 0, duplicate_detected: true, safety_flags: ["duplicate_direct_text_sha256"], knowledge_modified: false, vector_modified: false, publish_triggered: false, status: "duplicate" } } };
  }

  const entries: ZipIngestionEntryRecord[] = [];
  const candidates: ZipLearningCandidateRecord[] = [];
  for (const section of sections) {
    const entryId = `zie_${randomUUID()}`;
    const sectionHash = sha256(section.content);
    const classification = classifyText(section.content);
    const entry: ZipIngestionEntryRecord = { id: entryId, job_id: job.id, original_path: `${section.title}.md`, sanitized_path: basename(`${section.title}.md`), extension: extname("owner-direct-text.md"), mime_guess: "text/markdown", size_bytes: Buffer.byteLength(section.content, "utf8"), sha256: sectionHash, status: "accepted", reject_reason: "", extracted_text_length: section.content.length, parser_used: "owner_direct_text" };
    const candidate: ZipLearningCandidateRecord = { id: `zlc_${randomUUID()}`, source: "owner_direct_text", source_job_id: job.id, source_entry_id: entryId, candidate_type: classification.candidateType, extracted_text: section.content, status: "pending_owner_review", confidence: classification.confidence, created_at: now, approved_by: null, approved_at: null, ...sectionMetadata(section.content, section.title, classification.candidateType, sectionHash) };
    entries.push(entry);
    candidates.push(candidate);
    input.zipStore.saveEntry(entry);
    input.zipStore.saveLearningCandidate(candidate);
  }
  input.logger?.info({ event_type: "OWNER_DIRECT_KNOWLEDGE_REVIEW_CREATED", job_id: job.id, section_count: candidates.length, active_claim: false });
  return { status: "created", result: { job, entries, candidates, manifest: { job_id: job.id, original_filename: job.original_filename, zip_sha256: sourceHash, created_at: now, sender_role: input.senderRole, source_instance: input.sourceInstance, total_entries: sections.length, accepted_entries: sections.length, rejected_entries: 0, reject_reasons_summary: {}, extracted_text_records: sections.length, media_records: 0, candidate_count: candidates.length, duplicate_detected: false, safety_flags: [], knowledge_modified: false, vector_modified: false, publish_triggered: false, status: "completed" } } };
}
