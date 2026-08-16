import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { inspectRuntimeKnowledgeState } from "../bridge/runtimeKnowledgeState.js";

describe("runtime knowledge state", () => {
  it("reports runtime source, backup, and manifest health without consulting git", () => {
    const dir = mkdtempSync(join(tmpdir(), "now-os-runtime-knowledge-"));
    const source = "# Runtime facts\n";
    const structured = JSON.stringify({
      app_facts: [{ app: "Test", android_name: "Test", ios_name: "Test", status: "owner_approved", aliases: [], capabilities: { text_only: true, video_required: false } }],
      general_work_model: { summary: "summary", workflow: "workflow", earnings_policy: "policy", payment_policy: "payment", setup_boundary: "setup" },
      policy_sections: {
        first_contact_boundary: "first contact", source_identity_tone: "source and tone",
        routing_matrix: "routing", application_independence: "independence", profile_bio_photo_rules: "profile",
        memory_rules: "memory", eligibility_rejection: "eligibility", installation_process: "installation process",
        installation_permission: "installation", installation_proof_retry: "installation proof",
        privacy_payment_support: "privacy", followup_closure_group_rules: "followup", owner_training_routing: "training routing"
      },
      owner_transfer_sections: []
    });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "app_facts.md"), source);
    writeFileSync(join(dir, "app_facts.md.backup-owner-transfer-1"), "# Previous facts\n");
    writeFileSync(join(dir, "app_facts_structured.json"), structured);
    writeFileSync(join(dir, "structured_knowledge_manifest.json"), JSON.stringify({ structured_hash: createHash("sha256").update(structured).digest("hex") }));

    const result = inspectRuntimeKnowledgeState(dir);
    expect(result.runtime_source_present).toBe(true);
    expect(result.runtime_source_readable).toBe(true);
    expect(result.latest_backup_present).toBe(true);
    expect(result.manifest_hash_valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails closed when the runtime source or backup is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "now-os-runtime-knowledge-"));
    const result = inspectRuntimeKnowledgeState(dir);
    expect(result.runtime_source_present).toBe(false);
    expect(result.latest_backup_present).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining(["RUNTIME_APP_FACTS_MISSING", "RUNTIME_APP_FACTS_BACKUP_MISSING"]));
  });
});
