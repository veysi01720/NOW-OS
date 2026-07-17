import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateKnowledgeSourceIntegrity, REQUIRED_KNOWLEDGE_SOURCE_FILES } from "../bridge/sourceIntegrity.js";
import { productionKnowledgeBankDir } from "../utils/testPathGuard.js";

function makeTempKnowledgeBank(): string {
  const dir = resolve(tmpdir(), `now-os-source-integrity-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeValidSources(dir: string) {
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
      ""
    ].join("\n"),
    "utf8"
  );
  writeFileSync(
    resolve(dir, "link_catalog.md"),
    "# Link Catalog\n\nGeneric store links are not allowed. Fake or tahmini links are forbidden. Link uydurmak yasak.\n",
    "utf8"
  );
  const trainingDir = resolve(dir, "owner_approved_training");
  mkdirSync(trainingDir, { recursive: true });
  for (let index = 1; index <= 5; index += 1) {
    writeFileSync(resolve(trainingDir, `v${index}.md`), `# Training ${index}\n\nOwner approved training content.\n`, "utf8");
  }
}

describe("source integrity gate", () => {
  it("hard fails in tests when the production knowledge bank path is used", () => {
    expect(() => validateKnowledgeSourceIntegrity({ knowledgeBankDir: productionKnowledgeBankDir() })).toThrow(
      /production data\/knowledge_bank path/i
    );
  });

  it("fails when required knowledge files are missing", () => {
    const dir = makeTempKnowledgeBank();
    try {
      writeValidSources(dir);
      rmSync(resolve(dir, "app_facts.md"));
      const result = validateKnowledgeSourceIntegrity({ knowledgeBankDir: dir });
      expect(result.publish_allowed).toBe(false);
      expect(result.missing_required_files).toContain("app_facts.md");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when a source file contains a MISSING placeholder", () => {
    const dir = makeTempKnowledgeBank();
    try {
      writeValidSources(dir);
      writeFileSync(resolve(dir, "workflow_rules.md"), "# workflow_rules.md\n\nMISSING\n", "utf8");
      const result = validateKnowledgeSourceIntegrity({ knowledgeBankDir: dir });
      expect(result.publish_allowed).toBe(false);
      expect(result.files_with_missing_placeholder).toContain("workflow_rules.md");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves owner approved training as a required publish condition", () => {
    const dir = makeTempKnowledgeBank();
    try {
      writeValidSources(dir);
      rmSync(resolve(dir, "owner_approved_training"), { recursive: true, force: true });
      const result = validateKnowledgeSourceIntegrity({ knowledgeBankDir: dir });
      expect(result.publish_allowed).toBe(false);
      expect(result.owner_approved_training_included).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when a required source file is suspiciously tiny", () => {
    const dir = makeTempKnowledgeBank();
    try {
      writeValidSources(dir);
      writeFileSync(resolve(dir, "faq.md"), "# FAQ\n", "utf8");
      const result = validateKnowledgeSourceIntegrity({ knowledgeBankDir: dir });
      expect(result.publish_allowed).toBe(false);
      expect(result.suspiciously_tiny_files).toContain("faq.md");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when official app facts or link policy are not preserved", () => {
    const dir = makeTempKnowledgeBank();
    try {
      writeValidSources(dir);
      writeFileSync(resolve(dir, "app_facts.md"), "# Official App Facts\n\nLayla only.\n", "utf8");
      writeFileSync(resolve(dir, "link_catalog.md"), "# Link Catalog\n\nLinks can be guessed.\n", "utf8");
      const result = validateKnowledgeSourceIntegrity({ knowledgeBankDir: dir });
      expect(result.publish_allowed).toBe(false);
      expect(result.app_facts_official_values_present).toBe(false);
      expect(result.link_catalog_policy_present).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes when official app facts, link policy, and training files exist", () => {
    const dir = makeTempKnowledgeBank();
    try {
      writeValidSources(dir);
      const result = validateKnowledgeSourceIntegrity({ knowledgeBankDir: dir });
      expect(result.publish_allowed).toBe(true);
      expect(result.app_facts_official_values_present).toBe(true);
      expect(result.link_catalog_policy_present).toBe(true);
      expect(result.training_files_count).toBe(5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
