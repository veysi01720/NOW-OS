import { test, expect, describe, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { PersistentIngestionStore } from "../storage/ingestionStore.js";
import { ingestPlatformMessage } from "../bridge/ingestion/ingestPipeline.js";
import { sanitizeMessageText } from "../bridge/ingestion/sanitizer.js";
import { classifyMessage } from "../bridge/ingestion/classifier.js";
import { InMemoryReportDataSource, InMemoryPublisherStore, InMemoryQueueStore } from "./testDoubles.js";
import { buildOwnerReportSummary } from "../bridge/ownerReport.js";

describe("Sanitizer", () => {
  it("masks phone numbers", () => {
    expect(sanitizeMessageText("Merhaba telim +90 555 123 45 67 dön")).toContain("[PHONE_MASKED]");
    expect(sanitizeMessageText("05551234567")).toContain("[PHONE_MASKED]");
  });

  it("masks API keys and tokens", () => {
    expect(sanitizeMessageText("My token is Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c")).toContain("Bearer [TOKEN_MASKED]");
    expect(sanitizeMessageText("key is sk-1234567890abcdefghij12345")).toContain("[TOKEN_MASKED]");
  });

  it("masks IBAN and Cards", () => {
    expect(sanitizeMessageText("IBAN: TR12 3456 7890 1234 5678 9012 34")).toContain("[IBAN_MASKED]");
    expect(sanitizeMessageText("Card: 1234-5678-9012-3456")).toContain("[CARD_MASKED]");
  });

  it("masks URLs", () => {
    expect(sanitizeMessageText("Check https://example.com/test")).toContain("[URL_MASKED]");
  });
});

describe("Classifier", () => {
  it("classifies candidate_interest", () => {
    expect(classifyMessage("başlamak istiyorum nerden")).toContain("candidate_interest");
  });

  it("classifies installation_problem", () => {
    expect(classifyMessage("uygulamayı yükleyemedim yardımcı olur musun")).toContain("installation_problem");
  });

  it("classifies training_question", () => {
    expect(classifyMessage("eğitim videosunu anlamadım")).toContain("training_question");
  });

  it("classifies payment_or_trust_question", () => {
    expect(classifyMessage("para ne zaman yatar güvenilir mi")).toContain("payment_or_trust_question");
  });

  it("classifies support_signal", () => {
    expect(classifyMessage("hata veriyor yapamadım")).toContain("support_signal");
  });

  it("classifies complaint_or_risk", () => {
    expect(classifyMessage("biri bana küfür etti şikayet etmek istiyorum")).toContain("complaint_or_risk");
  });

  it("defaults to unknown for random text", () => {
    expect(classifyMessage("naber kanka")).toEqual(["unknown"]);
  });
});

describe("Ingestion Pipeline", () => {
  let tmpDir: string;
  let store: PersistentIngestionStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "nowos-test-"));
    store = new PersistentIngestionStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("ingests a manual import message and deduplicates it", () => {
    const jobId = "job_1";
    store.saveJob({
      job_id: jobId,
      platform: "manual_import",
      source_type: "historic",
      status: "running",
      started_at: new Date().toISOString(),
      total_messages_seen: 0,
      total_messages_ingested: 0,
      total_duplicates_skipped: 0,
      total_learning_suggestions_created: 0,
      errors_sanitized: [],
      created_by_role: "owner"
    });

    const payload = {
      platform: "manual_import" as const,
      source_type: "historic",
      source_id: "src1",
      sender_id: "905551234567",
      sender_role_guess: "candidate",
      chat_type: "private",
      text: "Merhaba Layla kurulum yapamadım ödeme güvenilir mi?",
      timestamp: "2026-07-06T10:00:00Z",
      external_message_id: "ext123",
      thread_id: "",
      metadata: {}
    };

    ingestPlatformMessage(payload, jobId, store);

    let job = store.getJob(jobId)!;
    expect(job.total_messages_seen).toBe(1);
    expect(job.total_messages_ingested).toBe(1);
    expect(job.total_learning_suggestions_created).toBeGreaterThan(0);
    expect(job.total_duplicates_skipped).toBe(0);

    const suggestions = store.listLearningSuggestions();
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].status).toBe("pending_owner_review");
    expect(suggestions[0].proposed_text).not.toContain("905551234567");

    // Re-ingest the exact same payload (should be caught by primary key)
    ingestPlatformMessage(payload, jobId, store);
    job = store.getJob(jobId)!;
    expect(job.total_messages_seen).toBe(2);
    expect(job.total_messages_ingested).toBe(1);
    expect(job.total_duplicates_skipped).toBe(1);

    // Fallback dedupe check: new external_message_id but same content, source, sender, time
    const payloadFallback = { ...payload, external_message_id: "ext999" };
    ingestPlatformMessage(payloadFallback, jobId, store);
    job = store.getJob(jobId)!;
    expect(job.total_messages_seen).toBe(3);
    expect(job.total_messages_ingested).toBe(1);
    expect(job.total_duplicates_skipped).toBe(2);

    // Owner report integration
    const reportData = new InMemoryReportDataSource(
      [],
      new InMemoryQueueStore(),
      new InMemoryPublisherStore(),
      store.listJobs(),
      store.listLearningSuggestions()
    );

    const report = buildOwnerReportSummary(reportData);
    expect(report.ingestion_jobs_count).toBe(1);
    expect(report.pending_learning_suggestions_count).toBe(suggestions.length);
    expect(report.last_ingestion_status).toBe("running");
  });
});
