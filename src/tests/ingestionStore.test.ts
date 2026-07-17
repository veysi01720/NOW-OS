import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve } from "path";
import { rmSync } from "fs";
import { PersistentIngestionJobStore } from "../storage/ingestionJobStore.js";
import { PersistentNormalizedMessageStore } from "../storage/normalizedMessageStore.js";
import { runManualImportJob } from "../connectors/importService.js";

const JOB_FILE = resolve("data", "test_ingestion_jobs.json");
const MSG_FILE = resolve("data", "test_normalized_messages.json");

describe("SPEC-025B: Ingestion Job Store & Deduplication", () => {
  let jobStore: PersistentIngestionJobStore;
  let msgStore: PersistentNormalizedMessageStore;

  beforeEach(() => {
    try { rmSync(JOB_FILE, { force: true }); } catch {}
    try { rmSync(MSG_FILE, { force: true }); } catch {}
    jobStore = new PersistentIngestionJobStore(JOB_FILE);
    msgStore = new PersistentNormalizedMessageStore(MSG_FILE);
  });

  afterEach(() => {
    try { rmSync(JOB_FILE, { force: true }); } catch {}
    try { rmSync(MSG_FILE, { force: true }); } catch {}
  });

  it("completes a clean JSON import lifecycle", () => {
    const payload = {
      format: "json" as const,
      content: JSON.stringify([
        { message: "test message 1", source_id: "S-1", sender_id: "U-1" },
        { message: "test message 2", source_id: "S-2", sender_id: "U-2" }
      ]),
      platform: "whatsapp",
      source_type: "private_chat",
      created_by_role: "owner" as const
    };

    const job = runManualImportJob(payload, jobStore, msgStore);

    expect(job.status).toBe("completed");
    expect(job.imported_count).toBe(2);
    expect(job.skipped_duplicate_count).toBe(0);
    expect(job.rejected_count).toBe(0);
    expect(job.completed_at).toBeDefined();

    const msgs = msgStore.listByJobRef(job.job_ref);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].message_text_sanitized).toBe("test message 1");
    expect(msgs[0].platform).toBe("whatsapp");
    
    // Raw IDs should not be stored
    expect((msgs[0] as any).source_id).toBeUndefined();
    expect(msgs[0].source_safe_ref).toMatch(/^SRC-/);
  });

  it("handles duplicate imports safely via deduplication", () => {
    const payload = {
      format: "csv" as const,
      content: `message,source_id,sender_id,timestamp
duplicate test,S-99,U-99,2026-07-06T10:00:00Z`,
      platform: "telegram",
      source_type: "group",
      created_by_role: "manager" as const
    };

    // First run
    const job1 = runManualImportJob(payload, jobStore, msgStore);
    expect(job1.imported_count).toBe(1);
    expect(job1.skipped_duplicate_count).toBe(0);

    // Second run with EXACT SAME DATA
    const job2 = runManualImportJob(payload, jobStore, msgStore);
    expect(job2.imported_count).toBe(0);
    expect(job2.skipped_duplicate_count).toBe(1); // 1 skipped
    expect(job2.status).toBe("completed");

    // Message store should only have 1 message across both jobs
    const allMsgs = msgStore.listByJobRef(job1.job_ref).concat(msgStore.listByJobRef(job2.job_ref));
    expect(allMsgs).toHaveLength(1);
  });

  it("returns failed status safely when parser throws", () => {
    const payload = {
      format: "json" as const,
      content: "INVALID JSON {",
      platform: "unknown",
      source_type: "unknown",
      created_by_role: "owner" as const
    };

    const job = runManualImportJob(payload, jobStore, msgStore);
    expect(job.status).toBe("failed");
    expect(job.imported_count).toBe(0);
    expect(job.sanitized_error).toContain("No valid messages parsed");
    // Ensure raw payload is NOT in the error
    expect(job.sanitized_error).not.toContain("INVALID JSON {");
  });

  it("returns partial or failed status if no valid messages found but parses fine", () => {
    const payload = {
      format: "json" as const,
      content: JSON.stringify([{ empty: "row" }]), // parser will reject missing message
      platform: "whatsapp",
      source_type: "private_chat",
      created_by_role: "owner" as const
    };

    const job = runManualImportJob(payload, jobStore, msgStore);
    expect(job.status).toBe("failed");
    expect(job.sanitized_error).toContain("No valid messages");
  });
});
