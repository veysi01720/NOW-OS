import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createLearningFactDryRun, activateLearningFactDryRun, rollbackLearningFactPublish } from "../bridge/learningStructuredPublish.js";
import type { LearningSuggestion } from "../storage/ingestionTypes.js";

const suggestion = (type: string, text: string): LearningSuggestion => ({
  suggestion_id: "s-app-1", short_ref: "LRN-1", source_job_id: "job-1", platform: "manual_json",
  suggestion_class: "unknown", evidence_preview_sanitized: "sanitized", proposed_knowledge_type: type,
  proposed_text: text, confidence: 0.95, status: "approved_for_bundle", created_at: new Date().toISOString(),
});

describe("learning app-fact structured publish", () => {
  it("rejects non-app-fact learning types before a dry-run", () => {
    const dir = mkdtempSync(join(tmpdir(), "learning-publish-"));
    const result = createLearningFactDryRun(suggestion("tone_rule", "Use a friendly tone"), dir);
    expect(result.status).toBe("rejected");
    expect(result.reason_code).toBe("LEARNING_TYPE_NOT_APP_FACT_CANDIDATE");
    expect(existsSync(join(dir, "app_facts_structured.json"))).toBe(false);
  });

  it("blocks activation when manifest risk/conflict gates fail and preserves the active file", () => {
    const dir = mkdtempSync(join(tmpdir(), "learning-publish-"));
    const app = suggestion("app_fact_candidate", JSON.stringify({ app: "TestApp", android_name: "TestApp", ios_name: "TestApp", status: "owner_approved", capabilities: { text_only: true } }));
    const dryRun = createLearningFactDryRun(app, dir);
    expect(dryRun.activation_token).toBeDefined();
    mkdirSync(dir, { recursive: true });
    const activePath = join(dir, "app_facts_structured.json");
    writeFileSync(activePath, JSON.stringify({ version: "1.0", app_facts: [{ app: "Official", status: "owner_approved" }] }));
    const manifestPath = join(dir, "structured_publish_dry_runs", dryRun.dry_run_id!, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.risk_count = 1;
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const result = activateLearningFactDryRun(app, dryRun.activation_token!, dir);
    expect(result.status).toBe("blocked");
    expect(result.reason_code).toBe("HASH_SCHEMA_RISK_CONFLICT_GATE_FAILED");
    expect(readFileSync(activePath, "utf8")).toContain("Official");
    expect(readFileSync(activePath, "utf8")).not.toContain("TestApp");
  });

  it("restores the previous active structured facts after a successful publish", () => {
    const dir = mkdtempSync(join(tmpdir(), "learning-publish-"));
    const app = suggestion("app_fact_candidate", JSON.stringify({ app: "TestApp", android_name: "TestApp", ios_name: "TestApp", status: "owner_approved" }));
    writeFileSync(join(dir, "app_facts_structured.json"), JSON.stringify({ version: "1.0", app_facts: [{ app: "Official", status: "owner_approved" }] }));
    const dryRun = createLearningFactDryRun(app, dir);
    expect(activateLearningFactDryRun(app, dryRun.activation_token!, dir).status).toBe("activated");
    expect(readFileSync(join(dir, "app_facts_structured.json"), "utf8")).toContain("TestApp");
    expect(rollbackLearningFactPublish(dir)).toBe(true);
    expect(readFileSync(join(dir, "app_facts_structured.json"), "utf8")).toContain("Official");
    expect(readFileSync(join(dir, "app_facts_structured.json"), "utf8")).not.toContain("TestApp");
  });
});
