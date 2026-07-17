import Fastify from "fastify";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { registerReviewRoutes } from "../bridge/reviewRoutes.js";
import { ZipIngestionStore } from "../bridge/zipIngestion/store.js";
import type { ZipIngestionJobRecord, ZipLearningCandidateRecord } from "../bridge/zipIngestion/types.js";
import { REQUIRED_KNOWLEDGE_SOURCE_FILES } from "../bridge/sourceIntegrity.js";
import { PersistentActionAuditStore } from "../store/actionAuditStore.js";
import { createTestEnv } from "./testDoubles.js";
import { validStructuredAppFactsJson } from "./fixtures/knowledgeBankFixture.js";

describe("Phase 3B review routes", () => {
  let tempDir: string;
  let app: ReturnType<typeof Fastify>;
  let zipStore: ZipIngestionStore;
  let auditStore: PersistentActionAuditStore;
  let previousKnowledgeDir: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "nowos-review-routes-"));
    app = Fastify({ logger: false });
    zipStore = new ZipIngestionStore(join(tempDir, "zip-store.json"));
    auditStore = new PersistentActionAuditStore(join(tempDir, "audit.json"));
    previousKnowledgeDir = process.env.KNOWLEDGE_BANK_DIR;
    process.env.KNOWLEDGE_BANK_DIR = join(tempDir, "knowledge_bank");
    writeValidKnowledgeBank(process.env.KNOWLEDGE_BANK_DIR);
    seedZipStore(zipStore);
    registerReviewRoutes(app, {
      env: createTestEnv(),
      zipIngestionStore: zipStore,
      actionAuditStore: auditStore,
    });
  });

  afterEach(async () => {
    await app.close();
    if (previousKnowledgeDir === undefined) delete process.env.KNOWLEDGE_BANK_DIR;
    else process.env.KNOWLEDGE_BANK_DIR = previousKnowledgeDir;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("lists review jobs with risk and conflict counts", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/dashboard/review/jobs",
      headers: { "x-dashboard-token": "owner_secret" },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().jobs[0]).toEqual(
      expect.objectContaining({
        id: "zip_job_1",
        file_count: 2,
        candidate_count: 2,
        risk_count: expect.any(Number),
        conflict_count: expect.any(Number),
      }),
    );
    expect(response.body).not.toContain("@s.whatsapp.net");
    expect(response.body).not.toContain("@g.us");
    expect(response.body).not.toContain("905123456789");
  });

  it("lists pending candidates and exposes sanitized detail", async () => {
    const list = await app.inject({
      method: "GET",
      url: "/dashboard/review/candidates",
      headers: { "x-dashboard-token": "manager_secret" },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().candidates).toHaveLength(2);
    expect(list.json().candidates[0]).toEqual(
      expect.objectContaining({
        source_job_id: "zip_job_1",
        source_entry_id: expect.any(String),
        candidate_type: expect.any(String),
        extracted_text_preview: expect.any(String),
      }),
    );

    const detail = await app.inject({
      method: "GET",
      url: "/dashboard/review/candidates/cand_1",
      headers: { "x-dashboard-token": "owner_secret" },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().candidate.extracted_text_sanitized).not.toContain("905123456789");
    expect(detail.json().candidate.extracted_text_sanitized).not.toContain("@s.whatsapp.net");
    expect(detail.json().candidate.risk_flags).toContain("raw_phone_detected");
  });

  it("rejects normal users and logs unauthorized access safely", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/dashboard/review/candidates",
      headers: { "x-dashboard-token": "wrong" },
    });

    expect(response.statusCode).toBe(401);
    const logs = auditStore.getRecentLogs();
    expect(logs[0]).toEqual(
      expect.objectContaining({
        action_type: "review_unauthorized_access",
        actor_role: "unknown",
        target_safe_ref: "review_api",
      }),
    );
    expect(JSON.stringify(logs)).not.toContain("wrong");
  });

  it("approves candidates without publishing, vector changes, or active knowledge writes", async () => {
    const appFactsPath = resolve(process.env.KNOWLEDGE_BANK_DIR!, "app_facts.md");
    const before = readFileSync(appFactsPath, "utf8");

    const response = await app.inject({
      method: "POST",
      url: "/dashboard/review/candidates/cand_1/decision",
      headers: { "x-dashboard-token": "owner_secret", "x-idempotency-key": "review-approve-1" },
      payload: { decision: "approve", confirm: true, note: "Looks useful <script>x</script>" },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        publish_triggered: false,
        vector_modified: false,
        active_knowledge_modified: false,
      }),
    );
    expect(zipStore.getLearningCandidate("cand_1")?.status).toBe("approved_for_bundle");
    expect(readFileSync(appFactsPath, "utf8")).toBe(before);
    const logs = auditStore.getRecentLogs();
    expect(logs[0]).toEqual(
      expect.objectContaining({
        action_type: "zip_review_approve",
        actor_role: "owner",
        previous_status: "pending_owner_review",
        new_status: "approved_for_bundle",
        sanitized_reason: "Looks useful x",
      }),
    );
  });

  it("supports reject and needs_edit decisions with append-only audit events", async () => {
    const reject = await app.inject({
      method: "POST",
      url: "/dashboard/review/candidates/cand_1/decision",
      headers: { "x-dashboard-token": "manager_secret", "x-idempotency-key": "review-reject-1" },
      payload: { decision: "reject", confirm: true, note: "Outdated" },
    });
    const needsEdit = await app.inject({
      method: "POST",
      url: "/dashboard/review/candidates/cand_2/decision",
      headers: { "x-dashboard-token": "owner_secret", "x-idempotency-key": "review-edit-1" },
      payload: { decision: "needs_edit", confirm: true, note: "Needs softer wording" },
    });

    expect(reject.statusCode).toBe(200);
    expect(needsEdit.statusCode).toBe(200);
    expect(zipStore.getLearningCandidate("cand_1")?.status).toBe("rejected");
    expect(zipStore.getLearningCandidate("cand_2")?.status).toBe("needs_edit");
    const logs = auditStore.getRecentLogs();
    expect(logs.map((log) => log.action_type)).toEqual(
      expect.arrayContaining(["zip_review_reject", "zip_review_needs_edit"]),
    );
    expect(logs.length).toBe(2);
  });

  it("creates dry-run bundle from approved reviews without active publish side effects", async () => {
    await app.inject({
      method: "POST",
      url: "/dashboard/review/candidates/cand_1/decision",
      headers: { "x-dashboard-token": "owner_secret", "x-idempotency-key": "review-approve-dry-run" },
      payload: { decision: "approve", confirm: true },
    });

    const response = await app.inject({
      method: "POST",
      url: "/dashboard/review/dry-run-bundle",
      headers: { "x-dashboard-token": "owner_secret" },
      payload: { confirm: true },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        status: "dry_run_created",
        openai_publish_triggered: false,
        vector_modified: false,
        active_knowledge_modified: false,
        bundle_hash: expect.any(String),
      }),
    );
    expect(response.json().manifest.included_candidate_ids).toContain("cand_1");
    const logs = auditStore.getRecentLogs();
    expect(logs[0]).toEqual(
      expect.objectContaining({
        action_type: "zip_review_dry_run_bundle",
        target_safe_ref: response.json().dry_run_id,
      }),
    );
  });
});

function seedZipStore(store: ZipIngestionStore): void {
  const now = "2026-07-10T10:00:00.000Z";
  const job: ZipIngestionJobRecord = {
    id: "zip_job_1",
    created_at: now,
    updated_at: now,
    sender_role: "owner",
    sender_masked: "905***",
    source_channel: "whatsapp",
    source_instance: "nowakademi_bot",
    original_filename: "training.zip",
    zip_sha256: "abc",
    zip_size_bytes: 123,
    status: "completed",
    status_reason: "completed_pending_owner_review",
    total_entries: 2,
    accepted_entries: 2,
    rejected_entries: 0,
    extracted_text_records: 2,
    media_records: 0,
    duplicate_of_job_id: null,
    manifest_path: "manifest.json",
    approved_for_review: true,
  };
  store.saveJob(job);
  store.saveEntry({
    id: "entry_1",
    job_id: "zip_job_1",
    original_path: "lesson.txt",
    sanitized_path: "lesson.txt",
    extension: ".txt",
    mime_guess: "text/plain",
    size_bytes: 10,
    sha256: "e1",
    status: "accepted",
    reject_reason: "",
    extracted_text_length: 100,
    parser_used: "text",
  });
  store.saveEntry({
    id: "entry_2",
    job_id: "zip_job_1",
    original_path: "risk.txt",
    sanitized_path: "risk.txt",
    extension: ".txt",
    mime_guess: "text/plain",
    size_bytes: 10,
    sha256: "e2",
    status: "accepted",
    reject_reason: "",
    extracted_text_length: 100,
    parser_used: "text",
  });
  const candidates: ZipLearningCandidateRecord[] = [
    {
      id: "cand_1",
      source: "zip_ingestion",
      source_job_id: "zip_job_1",
      source_entry_id: "entry_1",
      candidate_type: "faq_candidate",
      extracted_text: "Candidate asked from 905123456789@s.whatsapp.net about setup.",
      status: "pending_owner_review",
      confidence: 0.9,
      created_at: now,
      approved_by: null,
      approved_at: null,
    },
    {
      id: "cand_2",
      source: "zip_ingestion",
      source_job_id: "zip_job_1",
      source_entry_id: "entry_2",
      candidate_type: "app_fact_candidate",
      extracted_text: "Layla iPhone name is something else. Garanti kazanç var.",
      status: "pending_owner_review",
      confidence: 0.8,
      created_at: now,
      approved_by: null,
      approved_at: null,
    },
  ];
  for (const candidate of candidates) store.saveLearningCandidate(candidate);
}

function writeValidKnowledgeBank(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const generic = "# Source\n\nThis is a valid owner-approved source file with enough content to pass the tiny-file guard.\n";
  for (const fileName of REQUIRED_KNOWLEDGE_SOURCE_FILES) writeFileSync(resolve(dir, fileName), generic, "utf8");
  writeFileSync(
    resolve(dir, "app_facts.md"),
    [
      "# Official App Facts",
      "| app | android_name | ios_name | invite_code | agency_bind_code | agency_code | official_url | status | notes |",
      "|---|---|---|---|---|---|---|---|---|",
      "| Layla | Layla | NIVI | 8UNHAWUFC |  |  |  | owner_approved | Text-only |",
      "| TanChat | TanChat | TanStar | X3XREZ |  |  |  | owner_approved | Active |",
      "| Amar | Amar | Amar Lite | xvrgZkf6 | 10621 |  |  | owner_approved | Agency binding |",
      "| Linky | Linky | Linky | M9W5B8 |  |  |  | owner_approved | Code |",
      "| Soyo | Soyo | Soyo | 3997 |  | 3997 |  | owner_approved | Code |",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(resolve(dir, "app_facts_structured.json"), validStructuredAppFactsJson(), "utf8");
  writeFileSync(
    resolve(dir, "link_catalog.md"),
    "# Link Catalog\n\nGeneric store links are not allowed. Fake or tahmini links are forbidden. Link uydurmak yasak.\n",
    "utf8",
  );
  const trainingDir = resolve(dir, "owner_approved_training");
  mkdirSync(trainingDir, { recursive: true });
  for (let index = 1; index <= 5; index += 1) {
    writeFileSync(resolve(trainingDir, `v${index}.md`), `# Training ${index}\n\nOwner approved training content.\n`, "utf8");
  }
}
