import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseStructuredAppFactsFromMarkdown,
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

  it("writes structured facts and routing rules from app_facts.md", () => {
    const dir = makeKnowledgeBank();

    const result = publishStructuredKnowledgeSources({ knowledgeBankDir: dir });

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
