import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  ZipIngestionEntryRecord,
  ZipIngestionJobRecord,
  ZipIngestionStoreData,
  ZipLearningCandidateRecord
} from "./types.js";

function emptyData(): ZipIngestionStoreData {
  return {
    schema_version: "1.0",
    jobs: {},
    entries: {},
    learning_candidates: {}
  };
}

export class ZipIngestionStore {
  private data: ZipIngestionStoreData;

  constructor(private readonly filePath = resolve("data", "zip_ingestion", "store.json")) {
    this.data = this.load();
  }

  saveJob(job: ZipIngestionJobRecord): void {
    this.data.jobs[job.id] = job;
    this.persist();
  }

  saveEntry(entry: ZipIngestionEntryRecord): void {
    this.data.entries[entry.id] = entry;
    this.persist();
  }

  saveLearningCandidate(candidate: ZipLearningCandidateRecord): void {
    this.data.learning_candidates[candidate.id] = candidate;
    this.persist();
  }

  getLearningCandidate(candidateId: string): ZipLearningCandidateRecord | undefined {
    return this.data.learning_candidates[candidateId];
  }

  reviewLearningCandidate(
    candidateId: string,
    decision: "approve" | "reject" | "needs_edit",
    actorRole: "owner" | "manager",
    noteSanitized?: string
  ): ZipLearningCandidateRecord | null {
    const current = this.data.learning_candidates[candidateId];
    if (!current) return null;
    const now = new Date().toISOString();
    const status =
      decision === "approve"
        ? "approved_for_bundle"
        : decision === "reject"
          ? "rejected"
          : "needs_edit";
    const updated: ZipLearningCandidateRecord = {
      ...current,
      status,
      reviewed_by: actorRole,
      reviewed_at: now,
      review_decision: decision,
      review_note_sanitized: noteSanitized ?? null,
      approved_by: decision === "approve" ? actorRole : current.approved_by,
      approved_at: decision === "approve" ? now : current.approved_at
    };
    this.data.learning_candidates[candidateId] = updated;
    this.persist();
    return updated;
  }

  findJobBySha256(sha256: string): ZipIngestionJobRecord | undefined {
    return Object.values(this.data.jobs).find((job) => job.zip_sha256 === sha256);
  }

  listJobs(): ZipIngestionJobRecord[] {
    return Object.values(this.data.jobs).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  getJob(jobId: string): ZipIngestionJobRecord | undefined {
    return this.data.jobs[jobId];
  }

  listEntries(jobId: string): ZipIngestionEntryRecord[] {
    return Object.values(this.data.entries).filter((entry) => entry.job_id === jobId);
  }

  listLearningCandidates(jobId?: string): ZipLearningCandidateRecord[] {
    const values = Object.values(this.data.learning_candidates);
    return jobId ? values.filter((candidate) => candidate.source_job_id === jobId) : values;
  }

  private load(): ZipIngestionStoreData {
    try {
      return { ...emptyData(), ...JSON.parse(readFileSync(this.filePath, "utf8")) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyData();
      }
      const corruptedPath = `${this.filePath}.corrupted-${Date.now()}`;
      renameSync(this.filePath, corruptedPath);
      return emptyData();
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
    renameSync(tmpPath, this.filePath);
  }
}
