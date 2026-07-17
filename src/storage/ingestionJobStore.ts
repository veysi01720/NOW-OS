import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { IngestionJob } from "../connectors/types.js";
import { generateSafeRef } from "../connectors/normalizeLayer.js";

export class PersistentIngestionJobStore {
  private items: IngestionJob[] = [];

  constructor(private readonly filePath: string) {
    this.load();
  }

  private load(): void {
    try {
      const data = readFileSync(this.filePath, "utf-8");
      this.items = JSON.parse(data);
    } catch {
      this.items = [];
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const tmpPath = `${this.filePath}.tmp`;
      writeFileSync(tmpPath, JSON.stringify(this.items, null, 2), "utf-8");
      renameSync(tmpPath, this.filePath);
    } catch (e) {
      console.error("Failed to persist ingestion jobs", e);
    }
  }

  createJob(
    platform: string,
    source_type: string,
    created_by_role: "owner" | "manager" | "system",
    import_batch_ref?: string,
    source_label_safe?: string
  ): IngestionJob {
    const job: IngestionJob = {
      job_ref: generateSafeRef("ING"),
      platform,
      source_type,
      status: "pending",
      started_at: new Date().toISOString(),
      imported_count: 0,
      skipped_duplicate_count: 0,
      rejected_count: 0,
      created_by_role,
      import_batch_ref,
      source_label_safe
    };
    this.items.push(job);
    this.persist();
    return job;
  }

  markRunning(job_ref: string): void {
    const job = this.getJobByRef(job_ref);
    if (job) {
      job.status = "running";
      this.persist();
    }
  }

  markCompleted(job_ref: string, counts: { imported: number; skipped: number; rejected: number }): void {
    const job = this.getJobByRef(job_ref);
    if (job) {
      job.status = counts.imported > 0 || counts.skipped > 0 ? "completed" : "failed";
      if (counts.rejected > 0 && counts.imported > 0) {
        job.status = "partial";
      }
      job.imported_count = counts.imported;
      job.skipped_duplicate_count = counts.skipped;
      job.rejected_count = counts.rejected;
      job.completed_at = new Date().toISOString();
      this.persist();
    }
  }

  markFailed(job_ref: string, sanitized_error: string): void {
    const job = this.getJobByRef(job_ref);
    if (job) {
      job.status = "failed";
      job.sanitized_error = sanitized_error;
      job.completed_at = new Date().toISOString();
      this.persist();
    }
  }

  listJobs(): IngestionJob[] {
    return [...this.items];
  }

  getJobByRef(job_ref: string): IngestionJob | undefined {
    return this.items.find((j) => j.job_ref === job_ref);
  }
}
