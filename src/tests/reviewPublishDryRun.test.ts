import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { createApprovedReviewsDryRun } from "../bridge/reviewPublishDryRun.js";
import { ZipIngestionStore } from "../bridge/zipIngestion/store.js";
import type { ZipLearningCandidateRecord } from "../bridge/zipIngestion/types.js";
import { REQUIRED_KNOWLEDGE_SOURCE_FILES } from "../bridge/sourceIntegrity.js";
import { validStructuredAppFactsJson } from "./fixtures/knowledgeBankFixture.js";

describe("Phase 3C approved reviews dry-run bundle", () => {
  let tempDir: string;
  let knowledgeDir: string;
  let outputRoot: string;
  let zipStore: ZipIngestionStore;

  beforeEach(() => {
    tempDir = join(tmpdir(), `nowos-phase3c-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    knowledgeDir = join(tempDir, "knowledge_bank");
    outputRoot = join(tempDir, "review_publish", "dry_runs");
    mkdirSync(knowledgeDir, { recursive: true });
    writeValidKnowledgeBank(knowledgeDir);
    zipStore = new ZipIngestionStore(join(tempDir, "zip-store.json"));
    seedCandidates(zipStore);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("includes only approved_for_bundle candidates and preserves official sources", () => {
    const beforeAppFacts = readFileSync(resolve(knowledgeDir, "app_facts.md"), "utf8");
    const result = createApprovedReviewsDryRun({
      zipStore,
      knowledgeBankDir: knowledgeDir,
      outputRoot,
      now: new Date("2026-07-10T10:00:00.000Z"),
    });
    const bundle = readFileSync(result.bundle_path, "utf8");

    expect(existsSync(result.manifest_path)).toBe(true);
    expect(result.bundle_hash).toHaveLength(64);
    expect(result.manifest.approved_candidate_count).toBe(3);
    expect(result.manifest.included_candidate_ids).toEqual(["approved_faq", "approved_link", "approved_risky"]);
    expect(result.manifest.excluded_candidate_ids).toEqual(["needs_edit_1", "pending_1", "rejected_1"]);
    expect(bundle).toContain("Approved FAQ answer");
    expect(bundle).not.toContain("Rejected content");
    expect(bundle).not.toContain("Needs edit content");
    expect(bundle).not.toContain("Pending content");
    expect(bundle).toContain("NIVI");
    expect(bundle).toContain("M9W5B8");
    expect(bundle).toContain("Sadece mesajlaşmak isteyen");
    expect(bundle).toContain("Kamera açmak istemeyen");
    expect(result.manifest.official_source_gate.pass).toBe(true);
    expect(result.manifest.official_source_gate.messaging_only_routing_evidence_present).toBe(true);
    expect(result.manifest.official_source_gate.critical_app_facts_anchors_present).toBe(true);
    expect(readFileSync(resolve(knowledgeDir, "app_facts.md"), "utf8")).toBe(beforeAppFacts);
    expect(result.manifest.knowledge_modified).toBe(false);
    expect(result.manifest.vector_modified).toBe(false);
    expect(result.manifest.openai_publish_triggered).toBe(false);
  });

  it("blocks owner approval readiness when app routing source is thin or placeholder", () => {
    writeFileSync(
      resolve(knowledgeDir, "app_routing_rules.md"),
      "# Source\n\nThis is a valid owner-approved source file with enough content to pass the tiny-file guard.\n",
      "utf8",
    );

    const result = createApprovedReviewsDryRun({
      zipStore,
      knowledgeBankDir: knowledgeDir,
      outputRoot,
      now: new Date("2026-07-10T10:00:00.000Z"),
    });

    expect(result.manifest.ready_for_owner_publish_approval).toBe(false);
    expect(result.manifest.official_source_gate.pass).toBe(false);
    expect(result.manifest.official_source_gate.thin_or_placeholder_files).toContain("app_routing_rules.md");
    expect(result.manifest.official_source_gate.messaging_only_routing_evidence_present).toBe(false);
  });

  it("passes the messaging-only static retrieval source check", () => {
    const result = createApprovedReviewsDryRun({
      zipStore,
      knowledgeBankDir: knowledgeDir,
      outputRoot,
      now: new Date("2026-07-10T10:00:00.000Z"),
    });
    const bundle = readFileSync(result.bundle_path, "utf8");

    expect(bundle).toMatch(/Sadece mesajlaşmak[\s\S]*Layla/i);
    expect(bundle).toMatch(/kamera[\s\S]*Layla/i);
    expect(bundle).toMatch(/Layla[\s\S]*(NIVI|NİVİ)/i);
    expect(result.manifest.ready_for_owner_publish_approval).toBe(true);
  });

  it("flags fake links and risky guarantee wording without promoting links", () => {
    const result = createApprovedReviewsDryRun({
      zipStore,
      knowledgeBankDir: knowledgeDir,
      outputRoot,
      now: new Date("2026-07-10T10:00:00.000Z"),
    });
    const bundle = readFileSync(result.bundle_path, "utf8");

    expect(result.manifest.risk_flag_count).toBeGreaterThanOrEqual(2);
    expect(result.manifest.conflict_count).toBeGreaterThanOrEqual(1);
    expect(result.manifest.risks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ risk_type: "risky_guarantee_language", guarded: true }),
        expect.objectContaining({ risk_type: "unverified_link", guarded: true }),
      ]),
    );
    expect(bundle).toContain("missing_link_until_officially_verified");
    expect(result.manifest.official_app_facts_preserved).toBe(true);
    expect(result.manifest.link_catalog_preserved).toBe(true);
    expect(result.manifest.owner_approved_training_included).toBe(true);
    expect(result.manifest.ready_for_owner_publish_approval).toBe(true);
  });

  it("sanitizes raw phones and JIDs in generated dry-run bundle", () => {
    const result = createApprovedReviewsDryRun({
      zipStore,
      knowledgeBankDir: knowledgeDir,
      outputRoot,
      now: new Date("2026-07-10T10:00:00.000Z"),
    });
    const bundle = readFileSync(result.bundle_path, "utf8");

    expect(bundle).not.toContain("905123456789");
    expect(bundle).not.toContain("@s.whatsapp.net");
    expect(bundle).not.toContain("@g.us");
  });
});

function seedCandidates(store: ZipIngestionStore): void {
  const now = "2026-07-10T10:00:00.000Z";
  const base = {
    source: "zip_ingestion" as const,
    source_job_id: "job_1",
    source_entry_id: "entry_1",
    confidence: 0.9,
    created_at: now,
    approved_by: "owner",
    approved_at: now,
  };
  const candidates: ZipLearningCandidateRecord[] = [
    { ...base, id: "approved_faq", candidate_type: "faq_candidate", status: "approved_for_bundle", extracted_text: "Approved FAQ answer from 905123456789@s.whatsapp.net." },
    { ...base, id: "approved_link", candidate_type: "link_candidate", status: "approved_for_bundle", extracted_text: "Candidate says use https://fake.example/link for Linky." },
    { ...base, id: "approved_risky", candidate_type: "workflow_candidate", status: "approved_for_bundle", extracted_text: "Garanti kazanç var denmemeli, bunu yumuşat." },
    { ...base, id: "rejected_1", candidate_type: "faq_candidate", status: "rejected", extracted_text: "Rejected content" },
    { ...base, id: "needs_edit_1", candidate_type: "faq_candidate", status: "needs_edit", extracted_text: "Needs edit content" },
    { ...base, id: "pending_1", candidate_type: "faq_candidate", status: "pending_owner_review", extracted_text: "Pending content" },
  ];
  for (const candidate of candidates) store.saveLearningCandidate(candidate);
}

function writeValidKnowledgeBank(dir: string): void {
  const generic = [
    "# Official Source",
    "",
    "Owner approved operational source content. This file intentionally contains real policy text for dry-run assembly tests.",
    "It carries stable operational guidance and must be copied into the bundle without replacing official source content.",
    "",
  ].join("\n");
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
      "| Timo | Timo | Timo | VVXVUD |  |  |  | owner_approved | Escalate details |",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(resolve(dir, "app_facts_structured.json"), validStructuredAppFactsJson(), "utf8");
  writeFileSync(
    resolve(dir, "app_routing_rules.md"),
    [
      "# App Routing Rules",
      "",
      "| Candidate profile | Recommended app |",
      "|---|---|",
      "| Sadece mesajlaşmak isteyen | Layla (iPhone: NİVİ) |",
      "| Kamera açmak istemeyen ama sesli yapabilen | Layla (iPhone: NİVİ) |",
      "| Yüz göstermek istemeyen veya text-only isteyen | Layla (iPhone: NİVİ) |",
      "",
      "Layla routing evidence must stay present for messaging-only candidates.",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    resolve(dir, "link_catalog.md"),
    [
      "# Link Catalog",
      "",
      "Generic store links are not allowed. Fake or tahmini links are forbidden. Link uydurmak yasak.",
      "Official URL yoksa kod veya ekran yönlendirmesi kullanılır; onaysız link güvenilir sayılmaz.",
      "",
    ].join("\n"),
    "utf8",
  );
  const trainingDir = resolve(dir, "owner_approved_training");
  mkdirSync(trainingDir, { recursive: true });
  for (let index = 1; index <= 5; index += 1) {
    writeFileSync(
      resolve(trainingDir, `v${index}.md`),
      [
        `# Training ${index}`,
        "",
        "Owner approved training content with enough operational detail to avoid thin-source rejection.",
        "This source is preserved as owner-approved training and is included as reference, not as an automatic override.",
        "",
      ].join("\n"),
      "utf8",
    );
  }
}
