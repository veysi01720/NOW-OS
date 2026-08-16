import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parsePolicySectionsFromMarkdown,
  parseOwnerTransferSectionsFromMarkdown,
  parseStructuredAppFactsFromMarkdown,
  normalizeHeading,
  publishStructuredKnowledgeSources,
} from "../bridge/structuredKnowledgePublish.js";
import { validAppFactsMarkdown } from "./fixtures/knowledgeBankFixture.js";

describe("structured knowledge publish", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function makeKnowledgeBank(): string {
    const dir = mkdtempSync(join(tmpdir(), "now-os-structured-publish-"));
    dirs.push(dir);
    writeFileSync(resolve(dir, "app_facts.md"), validAppFactsMarkdown(true), "utf8");
    return dir;
  }

  it("parses owner-approved markdown app facts into machine-readable facts", () => {
    const facts = parseStructuredAppFactsFromMarkdown(validAppFactsMarkdown(true));
    const layla = facts.find((fact) => fact.app === "Layla");

    expect(layla).toEqual(expect.objectContaining({
      app: "Layla",
      ios_name: "NIVI",
      invite_code: "8UNHAWUFC",
      status: "owner_approved",
      capabilities: { text_only: true, video_required: false },
    }));
    expect(layla?.aliases).toContain("NIVI");
    expect(facts.map((fact) => fact.app)).toContain("Timo");
  });

  it("parses all approved policy sections into the structured schema", () => {
    const sections = parsePolicySectionsFromMarkdown(validAppFactsMarkdown(true));
    expect(sections).toEqual(expect.objectContaining({
      first_contact_boundary: expect.stringContaining("First contact fixture"),
      source_identity_tone: expect.stringContaining("Source fixture"),
      routing_matrix: expect.stringContaining("Routing matrix fixture"),
      application_independence: expect.stringContaining("Application independence fixture"),
      profile_bio_photo_rules: expect.stringContaining("Profile fixture"),
      memory_rules: expect.stringContaining("Memory fixture"),
      eligibility_rejection: expect.stringContaining("Eligibility fixture"),
      installation_process: expect.stringContaining("Installation process fixture"),
      installation_permission: expect.stringContaining("Installation fixture"),
      installation_proof_retry: expect.stringContaining("Installation proof fixture"),
      privacy_payment_support: expect.stringContaining("Privacy fixture"),
      followup_closure_group_rules: expect.stringContaining("Follow-up fixture"),
      owner_training_routing: expect.stringContaining("Training routing fixture"),
    }));
  });

  it.each([
    ["Turkish", "Genel İş Modeli"],
    ["ASCII", "Genel Is Modeli"],
    ["mixed Turkish I", "Genel İs Modeli"],
    ["uppercase Turkish", "GENEL İŞ MODELİ"],
    ["mojibake", "Genel Ä°ÅŸ Modeli"],
  ])("parses %s general work model heading", (_label, heading) => {
    const markdown = validAppFactsMarkdown(true).replace(/^##\s+.+$/mu, `## ${heading}`);
    const normalized = normalizeHeading(heading);
    expect(normalized).toBe("genel is modeli");
    const dir = mkdtempSync(join(tmpdir(), "now-os-general-heading-"));
    dirs.push(dir);
    writeFileSync(resolve(dir, "app_facts.md"), markdown, "utf8");

    const result = publishStructuredKnowledgeSources({ knowledgeBankDir: dir, mode: "activate", ownerApproval: true });

    expect(result.status).toBe("published");
    expect(JSON.parse(readFileSync(resolve(dir, "app_facts_structured.json"), "utf8")).general_work_model).toEqual(
      expect.objectContaining({ app_independent: true }),
    );
  });

  it("parses policy headings across Turkish, ASCII, and mojibake variants", () => {
    const variants = [
      "Kurulum Sureci",
      "Uygulama Yonlendirme Matrisi",
      "Uygulama Bagimsizligi",
      "Profil, Bio ve Fotograf Kurallari",
      "BELLEK VE TEKRAR SORMAMA",
      "Ilk Temas Siniri",
      "KAYNAK KIMLIK VE TON",
      "Uygunluk ve Red",
      "Kurulum Izni",
      "Uygulama Ozel Kurulum Kaniti ve Retry",
      "Gizlilik, Odeme ve Teknik Destek",
      "Takip, Kapanis ve Grup Operasyonlari",
      "Owner Uzerinden Dinamik Egitim Yonlendirme",
    ];
    let markdown = validAppFactsMarkdown(true);
    let headingIndex = 0;
    let policyHeadingIndex = 0;
    markdown = markdown.replace(/^##\s+.+$/gmu, (line) => {
      if (headingIndex++ === 0 || policyHeadingIndex >= variants.length) return line;
      return `## ${variants[policyHeadingIndex++]}`;
    });
    expect(parsePolicySectionsFromMarkdown(markdown)).toEqual(expect.objectContaining({
      first_contact_boundary: expect.any(String),
      source_identity_tone: expect.any(String),
      routing_matrix: expect.any(String),
      application_independence: expect.any(String),
      profile_bio_photo_rules: expect.any(String),
      memory_rules: expect.any(String),
      eligibility_rejection: expect.any(String),
      installation_process: expect.any(String),
      installation_permission: expect.any(String),
      installation_proof_retry: expect.any(String),
      privacy_payment_support: expect.any(String),
      followup_closure_group_rules: expect.any(String),
      owner_training_routing: expect.any(String),
    }));
  });

  it("publishes the app-independent general work model separately from app facts", () => {
    const dir = makeKnowledgeBank();
    const result = publishStructuredKnowledgeSources({ knowledgeBankDir: dir, mode: "activate", ownerApproval: true });
    expect(result.status).toBe("published");
    const structured = JSON.parse(readFileSync(resolve(dir, "app_facts_structured.json"), "utf8"));
    expect(Object.keys(structured.policy_sections)).toEqual(expect.arrayContaining([
      "first_contact_boundary",
      "source_identity_tone",
      "routing_matrix",
      "application_independence",
      "profile_bio_photo_rules",
      "memory_rules",
      "eligibility_rejection",
      "installation_process",
      "installation_permission",
      "installation_proof_retry",
      "privacy_payment_support",
      "followup_closure_group_rules",
      "owner_training_routing",
    ]));
    expect(structured.general_work_model).toEqual(expect.objectContaining({
      app_independent: true,
      source_section: "Genel İş Modeli",
    }));
    expect(structured.general_work_model.earnings_policy).not.toMatch(/\d+\s*(tl|lira|usd|dolar)/iu);
  });

  it("publishes headingless owner transfer material into structured facts", () => {
    const dir = makeKnowledgeBank();
    const sourcePath = resolve(dir, "app_facts.md");
    const ownerRule = "Erkek adaylar sadece owner onayli kadin profil kuraliyla ilerler; bu bilgi adaya acikca sorulur.";
    writeFileSync(sourcePath, `${readFileSync(sourcePath, "utf8").trimEnd()}\n\n## Owner Transfer [constraint]: Owner direct bilgi\n\n${ownerRule}\n`, "utf8");

    expect(parseOwnerTransferSectionsFromMarkdown(readFileSync(sourcePath, "utf8"))).toEqual([
      expect.objectContaining({ title: "Owner direct bilgi", content: ownerRule, classification: "constraint" }),
    ]);
    const result = publishStructuredKnowledgeSources({ knowledgeBankDir: dir, mode: "activate", ownerApproval: true });
    expect(result.status).toBe("published");
    const structured = JSON.parse(readFileSync(resolve(dir, "app_facts_structured.json"), "utf8"));
    expect(structured.owner_transfer_sections).toEqual([
      expect.objectContaining({ title: "Owner direct bilgi", content: ownerRule, classification: "constraint" }),
    ]);
  });

  it("deduplicates identical owner transfer content by hash", () => {
    const dir = makeKnowledgeBank();
    const sourcePath = resolve(dir, "app_facts.md");
    const ownerRule = "Ayni owner bilgisi tekrar geldiginde tek kayit tutulur.";
    writeFileSync(sourcePath, `${readFileSync(sourcePath, "utf8").trimEnd()}\n\n## Owner Transfer: Owner direct bilgi\n\n${ownerRule}\n\n## Owner Transfer: Owner direct bilgi\n\n${ownerRule}\n`, "utf8");
    const result = publishStructuredKnowledgeSources({ knowledgeBankDir: dir, mode: "activate", ownerApproval: true });
    expect(result.status).toBe("published");
    const structured = JSON.parse(readFileSync(resolve(dir, "app_facts_structured.json"), "utf8"));
    expect(structured.owner_transfer_sections).toHaveLength(1);
  });

  it("writes structured facts and routing rules from app_facts.md", () => {
    const dir = makeKnowledgeBank();

    const result = publishStructuredKnowledgeSources({ knowledgeBankDir: dir, mode: "activate", ownerApproval: true });

    expect(result.status).toBe("published");
    expect(result.app_fact_count).toBe(6);
    expect(result.structured_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.routing_rules_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(existsSync(resolve(dir, "app_facts_structured.json"))).toBe(true);
    expect(existsSync(resolve(dir, "app_routing_rules.md"))).toBe(true);

    const structured = JSON.parse(readFileSync(resolve(dir, "app_facts_structured.json"), "utf8"));
    expect(structured.app_facts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        app: "Layla",
        ios_name: "NIVI",
        capabilities: expect.objectContaining({ text_only: true }),
      }),
    ]));
    expect(readFileSync(resolve(dir, "app_routing_rules.md"), "utf8")).toContain("Layla (iPhone: NIVI)");
    expect(result.manifest_path).toBe(resolve(dir, "structured_knowledge_manifest.json"));
    expect(result.manifest_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(existsSync(resolve(dir, "structured_knowledge_manifest.json"))).toBe(true);
    expect(existsSync(resolve(dir, "structured_knowledge_rollback.json"))).toBe(true);
    const manifest = JSON.parse(readFileSync(resolve(dir, "structured_knowledge_manifest.json"), "utf8"));
    expect(manifest).toEqual(expect.objectContaining({
      source_file: "app_facts.md",
      structured_file: "app_facts_structured.json",
      routing_rules_file: "app_routing_rules.md",
      app_fact_count: 6,
    }));
  });

  it("creates a hash-gated dry-run without mutating active structured facts", () => {
    const dir = makeKnowledgeBank();
    publishStructuredKnowledgeSources({ knowledgeBankDir: dir, mode: "activate", ownerApproval: true });
    const activePath = resolve(dir, "app_facts_structured.json");
    const activeBefore = readFileSync(activePath, "utf8");

    const result = publishStructuredKnowledgeSources({
      knowledgeBankDir: dir,
      mode: "dry_run",
      dryRunId: "structured_test_run",
    });

    expect(result.status).toBe("dry_run");
    expect(result.rollback_pointer_ready).toBe(true);
    expect(result.source_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.manifest_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(readFileSync(activePath, "utf8")).toBe(activeBefore);
    expect(result.structured_path).toContain("structured_publish_dry_runs");
    expect(existsSync(result.manifest_path)).toBe(true);
  });

  it("requires explicit approval before activating derived structured facts", () => {
    const dir = makeKnowledgeBank();
    const result = publishStructuredKnowledgeSources({ knowledgeBankDir: dir, mode: "activate" });

    expect(result.status).toBe("blocked_no_owner_approval");
    expect(result.rollback_pointer_ready).toBe(false);
  });

  it("skips safely when app_facts.md is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "now-os-structured-publish-missing-"));
    dirs.push(dir);

    const result = publishStructuredKnowledgeSources({ knowledgeBankDir: dir });

    expect(result.status).toBe("skipped_missing_app_facts");
    expect(result.app_fact_count).toBe(0);
    expect(existsSync(resolve(dir, "app_facts_structured.json"))).toBe(false);
    expect(existsSync(resolve(dir, "app_routing_rules.md"))).toBe(false);
  });
});
