import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildOwnerKnowledgeReviewSummary, materializeApprovedOwnerKnowledge } from "../bridge/ownerKnowledgeTransfer.js";
import { ZipIngestionStore } from "../bridge/zipIngestion/store.js";
import type { ZipIngestionJobRecord, ZipLearningCandidateRecord } from "../bridge/zipIngestion/types.js";
import { createDirectOwnerKnowledgeReview } from "../bridge/ownerKnowledgeIntake.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function knowledgeBank(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const generic = "# Source\n\nOwner approved source content with enough detail for validation.\n";
  for (const file of ["app_routing_rules.md", "link_catalog.md", "owner_rules.md", "safety_boundaries.md", "training_content.md"]) writeFileSync(resolve(dir, file), generic);
  const headings = [
    "Uygulama Yönlendirme Matrisi", "Uygulama Bağımsızlığı", "Profil Bio ve Fotoğraf Kuralları",
    "Bellek ve Tekrar Sormama", "Uygunluk ve Red", "Kurulum İzni", "Gizlilik Ödeme ve Teknik Destek", "Takip Kapanış ve Grup Operasyonları",
  ];
  const policy = headings.map((heading) => `## ${heading}\n\nMevcut owner politikası ve güvenli uygulama kuralı.`).join("\n\n");
  writeFileSync(resolve(dir, "app_facts.md"), [
    "# Official App Facts",
    "| app | android_name | ios_name | invite_code | agency_bind_code | agency_code | official_url | status | notes |",
    "|---|---|---|---|---|---|---|---|---|",
    "| Layla | Layla | NIVI | CODE |  |  |  | owner_approved | Text-only |",
    "## Genel İş Modeli",
    "- summary: Puan ve çalışma modeli kurallara ve performansa bağlıdır.",
    "- workflow: Kurulum, profil ve eğitim adımları izlenir.",
    "- earnings_policy: Kazanç garanti edilmez; performansa ve kurallara bağlıdır.",
    "- payment_policy: Ödeme kurallara göre işlenir.",
    "- setup_boundary: Kurulum doğrulanmadan eğitim başlamaz.",
    policy,
    "",
  ].join("\n"));
}

function seed(store: ZipIngestionStore, contents: string[]): void {
  const now = new Date().toISOString();
  const job: ZipIngestionJobRecord = { id: "zip_transfer_test", created_at: now, updated_at: now, sender_role: "owner", sender_masked: "905***", source_channel: "whatsapp", source_instance: "test", original_filename: "eight-sections.zip", zip_sha256: "archive-hash", zip_size_bytes: 8, status: "completed", status_reason: "pending_owner_review", total_entries: 8, accepted_entries: 8, rejected_entries: 0, extracted_text_records: 8, media_records: 0, duplicate_of_job_id: null, manifest_path: "manifest.json", approved_for_review: true };
  store.saveJob(job);
  contents.forEach((content, index) => {
    const sectionHash = hash(content);
    const candidate: ZipLearningCandidateRecord = { id: `section_${index + 1}`, source: "zip_ingestion", source_job_id: job.id, source_entry_id: `entry_${index + 1}`, candidate_type: "app_fact_candidate", extracted_text: content, status: index < 2 ? "approved_for_bundle" : "rejected", confidence: 1, created_at: now, approved_by: index < 2 ? "owner" : null, approved_at: index < 2 ? now : null, section_id: `section_${index + 1}`, section_title: `Section ${index + 1}`, classification: "information", target_file: "app_facts.md", source_hash: sectionHash, section_hash: sectionHash };
    store.saveLearningCandidate(candidate);
  });
}

describe("owner knowledge transfer chain", () => {
  it("keeps eight sections reviewable and materializes only the two approved sections", () => {
    const dir = mkdtempSync(join(tmpdir(), "owner-transfer-"));
    try {
      const bank = join(dir, "knowledge_bank");
      knowledgeBank(bank);
      const store = new ZipIngestionStore(join(dir, "zip-store.json"));
      const contents = ["## Incoming 1\nKurulumda takilan aday: Approved section 1.", ...Array.from({ length: 7 }, (_, index) => `## Incoming ${index + 2}\nApproved section ${index + 2}.`)];
      seed(store, contents);
      expect(store.listLearningCandidates("zip_transfer_test")).toHaveLength(8);
      const summary = buildOwnerKnowledgeReviewSummary(store.getJob("zip_transfer_test")!, store.listLearningCandidates("zip_transfer_test"));
      expect(summary.detected_sections).toHaveLength(8);
      expect(summary.active_claim).toBe(false);
      const before = readFileSync(resolve(bank, "app_facts.md"), "utf8");
      const result = materializeApprovedOwnerKnowledge({ jobId: "zip_transfer_test", zipStore: store, knowledgeBankDir: bank });
      const after = readFileSync(resolve(bank, "app_facts.md"), "utf8");
      expect(result.status).toBe("published");
      expect(result.approved_section_ids).toEqual(["section_1", "section_2"]);
      expect(result.rejected_section_ids).toHaveLength(6);
      expect(after).not.toBe(before);
      expect(after).toContain("Approved section 1");
      expect(after).toContain("Approved section 2");
      expect(after).not.toContain("Approved section 3");
      expect(result.verification?.source_present).toBe(true);
      expect(result.verification?.structured_fields).toContain("owner_transfer_sections");
      expect(result.verification?.context_paths).toContain("structured_facts.owner_transfer_sections");
      expect(result.verification?.context_paths).toContain("decision_context.canonical_policy_facts:technical_issue");
      expect(store.getLearningCandidate("section_1")?.status).toBe("published");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves the previous markdown version when a section hash fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "owner-transfer-hash-"));
    try {
      const bank = join(dir, "knowledge_bank");
      knowledgeBank(bank);
      const store = new ZipIngestionStore(join(dir, "zip-store.json"));
      seed(store, ["## Valid section\nA valid update.", ...Array.from({ length: 7 }, (_, index) => `## Rejected ${index}\nRejected.`)]);
      const path = resolve(bank, "app_facts.md");
      const before = readFileSync(path, "utf8");
      const candidate = store.getLearningCandidate("section_1")!;
      store.saveLearningCandidate({ ...candidate, section_hash: "forced-mismatch" });
      const result = materializeApprovedOwnerKnowledge({ jobId: "zip_transfer_test", zipStore: store, knowledgeBankDir: bank });
      expect(result.status).toBe("failed");
      expect(result.error_code).toBe("OWNER_TRANSFER_SECTION_HASH_MISMATCH");
      expect(readFileSync(path, "utf8")).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("materializes #bilgi content only after the review approval", () => {
    const dir = mkdtempSync(join(tmpdir(), "owner-direct-text-"));
    try {
      const bank = join(dir, "knowledge_bank");
      knowledgeBank(bank);
      const store = new ZipIngestionStore(join(dir, "zip-store.json"));
      const created = createDirectOwnerKnowledgeReview({
        text: "## Owner bilgi\n\nBu bilgi onaydan sonra aktif facts'e eklenir.",
        senderRole: "owner",
        senderPhone: "905111111111",
        sourceInstance: "test",
        zipStore: store,
      });
      expect(created.status).toBe("created");
      const jobId = created.result!.job.id;
      const factsPath = resolve(bank, "app_facts.md");
      const before = readFileSync(factsPath, "utf8");
      expect(before).not.toContain("Bu bilgi onaydan sonra");

      const candidate = store.listLearningCandidates(jobId)[0];
      store.reviewLearningCandidate(candidate.id, "approve", "owner");
      const result = materializeApprovedOwnerKnowledge({ jobId, zipStore: store, knowledgeBankDir: bank });
      expect(result.status).toBe("published");
      expect(readFileSync(factsPath, "utf8")).toContain("Bu bilgi onaydan sonra aktif facts'e eklenir.");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not claim success when structured verification cannot find the approved section", () => {
    const dir = mkdtempSync(join(tmpdir(), "owner-transfer-verify-"));
    try {
      const bank = join(dir, "knowledge_bank");
      knowledgeBank(bank);
      const store = new ZipIngestionStore(join(dir, "zip-store.json"));
      seed(store, ["## Verified section\nThis must be visible in structured facts.", ...Array.from({ length: 7 }, (_, index) => `## Rejected ${index}\nRejected.`)]);
      const path = resolve(bank, "app_facts.md");
      const before = readFileSync(path, "utf8");
      const result = materializeApprovedOwnerKnowledge({ jobId: "zip_transfer_test", zipStore: store, knowledgeBankDir: bank, forceStructuredVerificationFailure: true });
      expect(result.status).toBe("failed");
      expect(result.error_code).toContain("OWNER_TRANSFER_VERIFY_STRUCTURED_MISSING");
      expect(readFileSync(path, "utf8")).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
