import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { validateKnowledgeAtStartup } from "../bridge/knowledgeStartupGuard.js";

function fixture() {
  return {
    app_facts: ["Layla", "TanChat", "Amar", "Linky", "Soyo", "Timo"].map((app) => ({
      app, android_name: app, ios_name: app, invite_code: null, agency_bind_code: null, agency_code: null,
      official_url: null, status: "owner_approved", aliases: [], capabilities: { text_only: true, video_required: false },
    })),
    general_work_model: { summary: "Genel model", workflow: "Kurulum", earnings_policy: "Performansa bağlı", payment_policy: "1-3 iş günü IBAN, iptal edilemez", setup_boundary: "Kurulum" },
    policy_sections: {
      first_contact_boundary: "İlk temas",
      source_identity_tone: "Güncel kaynak",
      routing_matrix: "Layla TanChat Amar Linky Soyo Timo",
      application_independence: "Uygulamalar karıştırılmaz",
      profile_bio_photo_rules: "Profil kuralları",
      memory_rules: "Bilinen tekrar sorulmaz",
      eligibility_rejection: "Erkek 18-30, kadın 18-40; 18 altı kabul edilmez",
      installation_process: "Kurulum adımları ve kontrol ekranları",
      installation_permission: "Kurulum izni",
      installation_proof_retry: "Kanıt ve retry",
      privacy_payment_support: "1-3 iş günü IBAN, iptal edilemez",
      followup_closure_group_rules: "Grup kapalı",
      owner_training_routing: "Owner eğitim yönlendirmesi",
    },
  };
}

function writeTrainingFixture(dir: string): void {
  const source = "# Training\n\nOwner review only.\n";
  const structured = `${JSON.stringify({
    active_in_candidate_context: false,
    owner_review_required: true,
    sections: [{ id: "training", classification: "training", content: "Owner reviewed training." }],
  }, null, 2)}\n`;
  writeFileSync(join(dir, "training_content.md"), source);
  writeFileSync(join(dir, "training_content_structured.json"), structured);
  writeFileSync(join(dir, "training_knowledge_manifest.json"), JSON.stringify({
    active_in_candidate_context: false,
    owner_review_required: true,
    source_hash: createHash("sha256").update(source).digest("hex"),
    structured_hash: createHash("sha256").update(structured).digest("hex"),
  }));
}

describe("knowledge startup guard", () => {
  it("accepts a valid structured facts and manifest pair", () => {
    const dir = mkdtempSync(join(tmpdir(), "now-os-knowledge-"));
    const value = fixture();
    const raw = `${JSON.stringify(value)}\n`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "app_facts_structured.json"), raw);
    writeFileSync(join(dir, "structured_knowledge_manifest.json"), JSON.stringify({ structured_hash: createHash("sha256").update(raw).digest("hex") }));
    writeFileSync(join(dir, "app_facts.md"), "# Runtime app facts\n");
    writeFileSync(join(dir, "app_facts.md.backup-owner-transfer-1"), "# Previous runtime app facts\n");
    writeTrainingFixture(dir);
    expect(validateKnowledgeAtStartup(dir)).toMatchObject({ valid: true, approved_app_count: 6, manifest_status: "valid", training_knowledge_valid: true, training_candidate_context_isolated: true });
  });

  it("fails closed when the manifest hash does not match", () => {
    const dir = mkdtempSync(join(tmpdir(), "now-os-knowledge-"));
    const raw = `${JSON.stringify(fixture())}\n`;
    writeFileSync(join(dir, "app_facts_structured.json"), raw);
    writeFileSync(join(dir, "structured_knowledge_manifest.json"), JSON.stringify({ structured_hash: "wrong" }));
    writeFileSync(join(dir, "app_facts.md"), "# Runtime app facts\n");
    writeFileSync(join(dir, "app_facts.md.backup-owner-transfer-1"), "# Previous runtime app facts\n");
    writeTrainingFixture(dir);
    const result = validateKnowledgeAtStartup(dir);
    expect(result.valid).toBe(false);
    expect(result.error_codes).toContain("STRUCTURED_FACTS_HASH_MISMATCH");
  });

  it("warns about fallback policy conflicts without failing startup", () => {
    const dir = mkdtempSync(join(tmpdir(), "now-os-knowledge-"));
    const value = fixture();
    value.policy_sections.profile_bio_photo_rules = "Kamera zorunlu ve görüntülü çalışma şarttır.";
    const raw = `${JSON.stringify(value)}\n`;
    writeFileSync(join(dir, "app_facts_structured.json"), raw);
    writeFileSync(join(dir, "structured_knowledge_manifest.json"), JSON.stringify({ structured_hash: createHash("sha256").update(raw).digest("hex") }));
    writeFileSync(join(dir, "app_facts.md"), "# Runtime app facts\n");
    writeFileSync(join(dir, "app_facts.md.backup-owner-transfer-1"), "# Previous runtime app facts\n");
    writeTrainingFixture(dir);
    const result = validateKnowledgeAtStartup(dir);
    expect(result.valid).toBe(true);
    expect(result.fallback_policy_warning_codes).toContain("FALLBACK_CAMERA_POLICY_CONFLICT");
  });
});
