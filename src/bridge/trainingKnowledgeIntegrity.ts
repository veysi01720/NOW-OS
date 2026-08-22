import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export interface TrainingKnowledgeIntegrity {
  valid: boolean;
  source_present: boolean;
  structured_present: boolean;
  manifest_present: boolean;
  candidate_context_isolated: boolean;
  section_count: number;
  error_codes: string[];
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function atomicWrite(path: string, content: string): void {
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, content, "utf8");
  renameSync(temporary, path);
}

function slug(value: string): string {
  return value.toLocaleLowerCase("tr-TR").normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/gu, "_").replace(/^_|_$/g, "") || "training_section";
}

function parseTrainingSections(source: string): Array<{ id: string; classification: "training"; content: string }> {
  const headings = [...source.matchAll(/^##\s+(.+?)\s*$/gmu)];
  return headings.flatMap((heading, index) => {
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[index + 1]?.index ?? source.length;
    const content = source.slice(start, end).trim();
    return content ? [{ id: slug(heading[1]), classification: "training" as const, content }] : [];
  });
}

export interface TrainingKnowledgePublishResult {
  section_count: number;
  source_hash: string;
  structured_hash: string;
}

/** Writes the isolated training projection and its manifest atomically. */
export function publishTrainingKnowledgeSources(knowledgeBankDir: string): TrainingKnowledgePublishResult {
  const sourcePath = resolve(knowledgeBankDir, "training_content.md");
  const structuredPath = resolve(knowledgeBankDir, "training_content_structured.json");
  const manifestPath = resolve(knowledgeBankDir, "training_knowledge_manifest.json");
  const source = readFileSync(sourcePath, "utf8");
  const structured = `${JSON.stringify({
    version: "1.0",
    source: "training_content.md",
    active_in_candidate_context: false,
    owner_review_required: true,
    sections: parseTrainingSections(source),
  }, null, 2)}\n`;
  const manifest = `${JSON.stringify({
    version: "1.0",
    source_file: "training_content.md",
    structured_file: "training_content_structured.json",
    source_hash: sha256(source),
    structured_hash: sha256(structured),
    classification: "training",
    active_in_candidate_context: false,
    owner_review_required: true,
    publish_status: "owner_review_only",
  }, null, 2)}\n`;
  mkdirSync(knowledgeBankDir, { recursive: true });
  atomicWrite(structuredPath, structured);
  atomicWrite(manifestPath, manifest);
  return { section_count: parseTrainingSections(source).length, source_hash: sha256(source), structured_hash: sha256(structured) };
}

export function inspectTrainingKnowledgeIntegrity(knowledgeBankDir: string): TrainingKnowledgeIntegrity {
  const sourcePath = resolve(knowledgeBankDir, "training_content.md");
  const structuredPath = resolve(knowledgeBankDir, "training_content_structured.json");
  const manifestPath = resolve(knowledgeBankDir, "training_knowledge_manifest.json");
  const sourcePresent = existsSync(sourcePath);
  const structuredPresent = existsSync(structuredPath);
  const manifestPresent = existsSync(manifestPath);
  const errors: string[] = [];
  if (!sourcePresent) errors.push("TRAINING_SOURCE_MISSING");
  if (!structuredPresent) errors.push("TRAINING_STRUCTURED_MISSING");
  if (!manifestPresent) errors.push("TRAINING_MANIFEST_MISSING");

  let candidateContextIsolated = false;
  let sectionCount = 0;
  if (sourcePresent && structuredPresent && manifestPresent) {
    try {
      const source = readFileSync(sourcePath, "utf8");
      const structuredRaw = readFileSync(structuredPath, "utf8");
      const structured = JSON.parse(structuredRaw) as Record<string, unknown>;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
      const sections = Array.isArray(structured.sections) ? structured.sections : [];
      sectionCount = sections.length;
      candidateContextIsolated = structured.active_in_candidate_context === false
        && manifest.active_in_candidate_context === false
        && structured.owner_review_required === true
        && manifest.owner_review_required === true;
      if (!candidateContextIsolated) errors.push("TRAINING_CONTEXT_ISOLATION_INVALID");
      if (sections.length === 0 || sections.some((item) => (
        item === null
        || typeof item !== "object"
        || (item as Record<string, unknown>).classification !== "training"
        || typeof (item as Record<string, unknown>).content !== "string"
        || String((item as Record<string, unknown>).content).trim() === ""
      ))) errors.push("TRAINING_SECTIONS_INVALID");
      if (manifest.source_hash !== sha256(source)) errors.push("TRAINING_SOURCE_HASH_MISMATCH");
      if (manifest.structured_hash !== sha256(structuredRaw)) errors.push("TRAINING_STRUCTURED_HASH_MISMATCH");
    } catch {
      errors.push("TRAINING_KNOWLEDGE_PARSE_FAILED");
    }
  }

  return {
    valid: errors.length === 0,
    source_present: sourcePresent,
    structured_present: structuredPresent,
    manifest_present: manifestPresent,
    candidate_context_isolated: candidateContextIsolated,
    section_count: sectionCount,
    error_codes: [...new Set(errors)],
  };
}
