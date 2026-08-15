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
      routing_matrix: "Layla TanChat Amar Linky Soyo Timo",
      application_independence: "Uygulamalar karıştırılmaz",
      profile_bio_photo_rules: "Profil kuralları",
      memory_rules: "Bilinen tekrar sorulmaz",
      eligibility_rejection: "Erkek 18-30, kadın 18-40; 18 altı kabul edilmez",
      installation_permission: "Kurulum izni",
      privacy_payment_support: "1-3 iş günü IBAN, iptal edilemez",
      followup_closure_group_rules: "Grup kapalı",
    },
  };
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
    expect(validateKnowledgeAtStartup(dir)).toMatchObject({ valid: true, approved_app_count: 6, manifest_status: "valid" });
  });

  it("fails closed when the manifest hash does not match", () => {
    const dir = mkdtempSync(join(tmpdir(), "now-os-knowledge-"));
    const raw = `${JSON.stringify(fixture())}\n`;
    writeFileSync(join(dir, "app_facts_structured.json"), raw);
    writeFileSync(join(dir, "structured_knowledge_manifest.json"), JSON.stringify({ structured_hash: "wrong" }));
    writeFileSync(join(dir, "app_facts.md"), "# Runtime app facts\n");
    writeFileSync(join(dir, "app_facts.md.backup-owner-transfer-1"), "# Previous runtime app facts\n");
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
    const result = validateKnowledgeAtStartup(dir);
    expect(result.valid).toBe(true);
    expect(result.fallback_policy_warning_codes).toContain("FALLBACK_CAMERA_POLICY_CONFLICT");
  });
});
