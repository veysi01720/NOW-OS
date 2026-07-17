import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateKnowledgeSourceIntegrity, REQUIRED_KNOWLEDGE_SOURCE_FILES } from "../bridge/sourceIntegrity.js";
import { productionKnowledgeBankDir } from "../utils/testPathGuard.js";
import { validAppFactsMarkdown, writeValidKnowledgeBankFixture } from "./fixtures/knowledgeBankFixture.js";

function makeTempKnowledgeBank(): string {
  const dir = resolve(tmpdir(), `now-os-source-integrity-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeValidSources(dir: string) {
  writeValidKnowledgeBankFixture(dir);
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

  it("fails when structured app facts are missing or do not match markdown", () => {
    const dir = makeTempKnowledgeBank();
    try {
      writeValidSources(dir);
      rmSync(resolve(dir, "app_facts_structured.json"));
      const missing = validateKnowledgeSourceIntegrity({ knowledgeBankDir: dir });
      expect(missing.publish_allowed).toBe(false);
      expect(missing.structured_app_facts_present).toBe(false);

      writeValidSources(dir);
      writeFileSync(resolve(dir, "app_facts.md"), validAppFactsMarkdown().replace("NIVI", "WrongName"), "utf8");
      const mismatch = validateKnowledgeSourceIntegrity({ knowledgeBankDir: dir });
      expect(mismatch.publish_allowed).toBe(false);
      expect(mismatch.app_facts_structured_matches_markdown).toBe(false);
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
      expect(result.structured_app_facts_present).toBe(true);
      expect(result.structured_app_facts_valid).toBe(true);
      expect(result.structured_app_facts_official_values_present).toBe(true);
      expect(result.app_facts_structured_matches_markdown).toBe(true);
      expect(result.link_catalog_policy_present).toBe(true);
      expect(result.training_files_count).toBe(5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
