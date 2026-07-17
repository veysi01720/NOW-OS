import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { IngestionJob, LearningSuggestion, KnowledgePatch, PublishJob } from "./ingestionTypes.js";
import { logger } from "../observability/logger.js";

interface IngestionDataFile {
  schema_version: "1.0";
  ingestion_jobs: Record<string, IngestionJob>;
  ingested_message_hashes: string[];
  learning_suggestions: Record<string, LearningSuggestion>;
  knowledge_patches: Record<string, KnowledgePatch>;
  publish_jobs: Record<string, PublishJob>;
}

function emptyDataFile(): IngestionDataFile {
  return {
    schema_version: "1.0",
    ingestion_jobs: {},
    ingested_message_hashes: [],
    learning_suggestions: {},
    knowledge_patches: {},
    publish_jobs: {}
  };
}

export class PersistentIngestionStore {
  private fileData: IngestionDataFile = emptyDataFile();
  private readonly ingestedHashes = new Set<string>();

  constructor(private readonly dataDir: string) {
    this.load();
    this.backfillShortRefs();
    this.backfillLearningSafeRefs();
  }

  private backfillLearningSafeRefs(): void {
    let changed = false;
    for (const item of Object.values(this.fileData.learning_suggestions)) {
      if (!item.safe_ref) {
        item.safe_ref = this.generateLearningSafeRef();
        changed = true;
      }
    }
    if (changed) this.flush();
  }

  private generateLearningSafeRef(): string {
    const existingRefs = new Set<string>();
    for (const item of Object.values(this.fileData.learning_suggestions)) {
      if (item.safe_ref) existingRefs.add(item.safe_ref);
    }
    for (let i = 0; i < 10; i++) {
      const candidate = `LRN-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      if (!existingRefs.has(candidate)) return candidate;
    }
    throw new Error("Failed to generate unique safe_ref for learning suggestion");
  }

  private backfillShortRefs(): void {
    let changed = false;
    const items = Object.values(this.fileData.learning_suggestions).sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    let nextId = 1;
    // Find the max existing LRN number to avoid overlaps
    for (const item of items) {
      if (item.short_ref && item.short_ref.startsWith("LRN-")) {
        const num = parseInt(item.short_ref.replace("LRN-", ""), 10);
        if (!isNaN(num) && num >= nextId) {
          nextId = num + 1;
        }
      }
    }

    for (const item of items) {
      if (!item.short_ref) {
        item.short_ref = `LRN-${nextId++}`;
        changed = true;
      }
    }

    if (changed) {
      this.flush();
    }
  }

  private get filePath(): string {
    return resolve(this.dataDir, "ingestion.json");
  }

  private load(): void {
    try {
      const data = readFileSync(this.filePath, "utf-8");
      this.fileData = JSON.parse(data) as IngestionDataFile;
      if (!this.fileData.publish_jobs) this.fileData.publish_jobs = {};
      if (!this.fileData.learning_suggestions) this.fileData.learning_suggestions = {};
      if (!this.fileData.knowledge_patches) this.fileData.knowledge_patches = {};
      for (const hash of this.fileData.ingested_message_hashes || []) {
        this.ingestedHashes.add(hash);
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.error({ event_type: "INGESTION_STORE_LOAD_ERROR", error: err });
      }
      this.fileData = emptyDataFile();
    }
  }

  private flush(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      this.fileData.ingested_message_hashes = Array.from(this.ingestedHashes);
      
      const tmpPath = `${this.filePath}.tmp`;
      writeFileSync(tmpPath, JSON.stringify(this.fileData, null, 2), "utf-8");
      renameSync(tmpPath, this.filePath);
    } catch (err: unknown) {
      logger.error({ event_type: "INGESTION_STORE_FLUSH_ERROR", error: err });
    }
  }

  public getJob(jobId: string): IngestionJob | undefined {
    return this.fileData.ingestion_jobs[jobId];
  }

  public saveJob(job: IngestionJob): void {
    this.fileData.ingestion_jobs[job.job_id] = job;
    this.flush();
  }

  public listJobs(): IngestionJob[] {
    return Object.values(this.fileData.ingestion_jobs);
  }

  public hasMessageHash(hash: string): boolean {
    return this.ingestedHashes.has(hash);
  }

  public markMessageHash(hash: string): void {
    this.ingestedHashes.add(hash);
    this.flush();
  }

  public saveLearningSuggestion(suggestion: LearningSuggestion): void {
    if (!suggestion.short_ref) {
      let nextId = 1;
      for (const item of Object.values(this.fileData.learning_suggestions)) {
        if (item.short_ref && item.short_ref.startsWith("LRN-")) {
          const num = parseInt(item.short_ref.replace("LRN-", ""), 10);
          if (!isNaN(num) && num >= nextId) {
            nextId = num + 1;
          }
        }
      }
      suggestion.short_ref = `LRN-${nextId}`;
    }
    if (!suggestion.safe_ref) {
      suggestion.safe_ref = this.generateLearningSafeRef();
    }
    this.fileData.learning_suggestions[suggestion.suggestion_id] = suggestion;
    this.flush();
  }

  public getLearningSuggestion(id: string): LearningSuggestion | undefined {
    return this.fileData.learning_suggestions[id];
  }

  public getLearningSuggestionByShortRef(shortRef: string): LearningSuggestion | undefined {
    const upperRef = shortRef.toUpperCase();
    return Object.values(this.fileData.learning_suggestions).find(s => s.short_ref === upperRef);
  }

  public updateLearningSuggestionStatus(id: string, newStatus: import("./ingestionTypes.js").LearningSuggestionStatus, reviewedBy: string): boolean {
    const suggestion = this.fileData.learning_suggestions[id];
    if (!suggestion) return false;
    
    suggestion.status = newStatus;
    suggestion.reviewed_by = reviewedBy;
    suggestion.reviewed_at = new Date().toISOString();
    
    this.flush();
    return true;
  }

  public listLearningSuggestions(): LearningSuggestion[] {
    return Object.values(this.fileData.learning_suggestions);
  }

  public resolveSuggestionBySafeRef(ref: string): LearningSuggestion | undefined {
    return Object.values(this.fileData.learning_suggestions).find((item) => item.safe_ref === ref);
  }

  public reviewSuggestionBySafeRef(ref: string, newStatus: import("./ingestionTypes.js").LearningSuggestionStatus, reviewedBy: string): boolean {
    const suggestion = this.resolveSuggestionBySafeRef(ref);
    if (!suggestion) return false;

    suggestion.status = newStatus;
    suggestion.reviewed_by = reviewedBy;
    suggestion.reviewed_at = new Date().toISOString();
    
    this.flush();
    return true;
  }

  public saveKnowledgePatch(patch: KnowledgePatch): void {
    if (!patch.patch_ref) {
      let nextId = 1;
      for (const item of Object.values(this.fileData.knowledge_patches)) {
        if (item.patch_ref && item.patch_ref.startsWith("KB-")) {
          const num = parseInt(item.patch_ref.replace("KB-", ""), 10);
          if (!isNaN(num) && num >= nextId) {
            nextId = num + 1;
          }
        }
      }
      patch.patch_ref = `KB-${nextId}`;
    }
    this.fileData.knowledge_patches[patch.knowledge_patch_id] = patch;
    this.flush();
  }

  public getKnowledgePatch(id: string): KnowledgePatch | undefined {
    return this.fileData.knowledge_patches[id];
  }

  public getKnowledgePatchByRef(ref: string): KnowledgePatch | undefined {
    const upperRef = ref.toUpperCase();
    return Object.values(this.fileData.knowledge_patches).find(p => p.patch_ref === upperRef);
  }

  public listKnowledgePatches(): KnowledgePatch[] {
    return Object.values(this.fileData.knowledge_patches);
  }

  public savePublishJob(job: PublishJob): void {
    this.fileData.publish_jobs[job.publish_job_id] = job;
    this.flush();
  }

  public getPublishJob(id: string): PublishJob | undefined {
    return this.fileData.publish_jobs[id];
  }

  public listPublishJobs(): PublishJob[] {
    return Object.values(this.fileData.publish_jobs);
  }
}
