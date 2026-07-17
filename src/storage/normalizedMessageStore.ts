import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { NormalizedPlatformMessage } from "../connectors/types.js";
import { generateSafeRef } from "../connectors/normalizeLayer.js";

export interface StoredNormalizedPlatformMessage extends NormalizedPlatformMessage {
  message_ref: string;
  dedup_key: string;
  created_at: string;
}

export class PersistentNormalizedMessageStore {
  private items: StoredNormalizedPlatformMessage[] = [];

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
      console.error("Failed to persist normalized messages", e);
    }
  }

  existsByDedupKey(dedup_key: string): boolean {
    return this.items.some((msg) => msg.dedup_key === dedup_key);
  }

  insertIfNotDuplicate(
    msg: NormalizedPlatformMessage,
    dedup_key: string,
    ingestion_job_ref: string
  ): boolean {
    if (this.existsByDedupKey(dedup_key)) {
      return false; // Duplicate
    }

    const storedMsg: StoredNormalizedPlatformMessage = {
      ...msg,
      message_ref: generateSafeRef("MSG"),
      dedup_key,
      ingestion_job_ref,
      created_at: new Date().toISOString()
    };

    this.items.push(storedMsg);
    this.persist();
    return true; // Successfully inserted
  }

  listByJobRef(job_ref: string): StoredNormalizedPlatformMessage[] {
    return this.items.filter((m) => (m as any).ingestion_job_ref === job_ref);
  }

  listMessages(): StoredNormalizedPlatformMessage[] {
    return this.items;
  }

  countByJobRef(job_ref: string): number {
    return this.listByJobRef(job_ref).length;
  }
}
