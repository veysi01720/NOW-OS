import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { StructuredAppFact } from "./structuredAppFacts.js";

export interface StructuredKnowledgePublishResult {
  status: "published" | "dry_run" | "blocked_no_owner_approval" | "skipped_missing_app_facts" | "skipped_no_valid_rows";
  mode: "dry_run" | "activate";
  knowledge_bank_dir: string;
  app_facts_source_path: string;
  structured_path: string;
  routing_rules_path: string;
  app_fact_count: number;
  structured_hash: string | null;
  routing_rules_hash: string | null;
  manifest_path: string;
  manifest_hash: string | null;
  source_hash: string | null;
  rollback_pointer_ready: boolean;
  dry_run_id: string | null;
}

function knowledgeBankDir(input?: string): string {
  return resolve(input ?? process.env.KNOWLEDGE_BANK_DIR ?? resolve(process.cwd(), "data", "knowledge_bank"));
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function atomicWrite(path: string, content: string): void {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, content, "utf8");
  renameSync(temporaryPath, path);
}

function compact(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function emptyToNull(value: string | undefined): string | null {
  const normalized = compact(value);
  return normalized ? normalized : null;
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, "_");
}

function parseMarkdownTable(markdown: string): Array<Record<string, string>> {
  const tableLines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"));
  if (tableLines.length < 3) return [];

  const headers = tableLines[0]
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((part) => normalizeHeader(part));

  return tableLines
    .slice(2)
    .filter((line) => !/^\|\s*-+\s*\|/.test(line))
    .map((line) => {
      const values = line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((part) => part.trim());
      return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    });
}

function aliasesFor(row: Record<string, string>, app: string, androidName: string, iosName: string): string[] {
  const aliases = new Set<string>();
  if (androidName && androidName !== app) aliases.add(androidName);
  if (iosName && iosName !== app) aliases.add(iosName);
  const notes = compact(row.notes);
  for (const raw of notes.split(/[,;/]/)) {
    const value = compact(raw);
    if (/^[A-Z0-9 -]{2,30}$/i.test(value) && !/(active|text-only|code|agency|binding|escalate|details)/i.test(value)) {
      aliases.add(value);
    }
  }
  return Array.from(aliases);
}

export function parseStructuredAppFactsFromMarkdown(markdown: string): StructuredAppFact[] {
  return parseMarkdownTable(markdown)
    .map((row) => {
      const app = compact(row.app);
      const androidName = compact(row.android_name);
      const iosName = compact(row.ios_name);
      const status = compact(row.status);
      if (!app || !androidName || !iosName || !status) return null;
      const notes = compact(row.notes);
      const textOnly = /text-only|text only|mesaj|yazi|yaz[iı]/i.test(notes);
      const videoRequired = textOnly ? false : /kamera|video|goruntulu|görüntülü/i.test(notes) ? true : null;
      return {
        app,
        android_name: androidName,
        ios_name: iosName,
        invite_code: emptyToNull(row.invite_code),
        agency_bind_code: emptyToNull(row.agency_bind_code),
        agency_code: emptyToNull(row.agency_code),
        official_url: emptyToNull(row.official_url),
        status,
        aliases: aliasesFor(row, app, androidName, iosName),
        capabilities: {
          text_only: textOnly,
          video_required: videoRequired,
        },
      };
    })
    .filter((fact): fact is StructuredAppFact => fact !== null);
}

function buildStructuredJson(facts: StructuredAppFact[]): string {
  return `${JSON.stringify({
    version: "1.0",
    source: "generated_from_app_facts_md",
    generated_at: new Date().toISOString(),
    app_facts: facts,
  }, null, 2)}\n`;
}

function buildRoutingRules(facts: StructuredAppFact[]): string {
  const textOnly = facts.filter((fact) => fact.status && fact.capabilities.text_only);
  const rows = textOnly.length > 0
    ? textOnly.map((fact) =>
        `| Text-only, messaging-first, or camera-avoidant candidate | ${fact.app} (iPhone: ${fact.ios_name}) | ${fact.app} is marked text-only in app_facts.md; do not present camera/video as required. |`
      )
    : ["| Text-only or camera-avoidant candidate | owner_review_required | No text-only app is marked in app_facts.md; escalate instead of inventing routing. |"];

  return [
    "# App Routing Rules",
    "",
    "Generated from app_facts.md. Do not edit this file directly; update app_facts.md and run structured knowledge publish.",
    "",
    "| Candidate profile | Recommended app | Grounding |",
    "|---|---|---|",
    ...rows,
    "",
    "Routing safety:",
    "- Mention only owner-approved apps from app_facts.md.",
    "- For messaging/text-only candidates, prefer the text-only app if one is present.",
    "- Do not invent links, earnings, camera rules, account rules, or setup requirements.",
    "",
  ].join("\n");
}

export function publishStructuredKnowledgeSources(options: {
  knowledgeBankDir?: string;
  mode?: "dry_run" | "activate";
  ownerApproval?: boolean;
  dryRunId?: string;
} = {}): StructuredKnowledgePublishResult {
  const dir = knowledgeBankDir(options.knowledgeBankDir);
  const mode = options.mode ?? "activate";
  const dryRunId = options.dryRunId ?? `structured_${Date.now()}`;
  const appFactsSourcePath = resolve(dir, "app_facts.md");
  const structuredPath = resolve(dir, "app_facts_structured.json");
  const routingRulesPath = resolve(dir, "app_routing_rules.md");
  const manifestPath = resolve(dir, "structured_knowledge_manifest.json");

  if (!existsSync(appFactsSourcePath)) {
    return {
      status: "skipped_missing_app_facts",
      mode,
      knowledge_bank_dir: dir,
      app_facts_source_path: appFactsSourcePath,
      structured_path: structuredPath,
      routing_rules_path: routingRulesPath,
      app_fact_count: 0,
      structured_hash: null,
      routing_rules_hash: null,
      manifest_path: manifestPath,
      manifest_hash: null,
      source_hash: null,
      rollback_pointer_ready: false,
      dry_run_id: mode === "dry_run" ? dryRunId : null,
    };
  }

  const markdown = readFileSync(appFactsSourcePath, "utf8");
  const facts = parseStructuredAppFactsFromMarkdown(markdown);
  if (facts.length === 0) {
    return {
      status: "skipped_no_valid_rows",
      mode,
      knowledge_bank_dir: dir,
      app_facts_source_path: appFactsSourcePath,
      structured_path: structuredPath,
      routing_rules_path: routingRulesPath,
      app_fact_count: 0,
      structured_hash: null,
      routing_rules_hash: null,
      manifest_path: manifestPath,
      manifest_hash: null,
      source_hash: sha256(markdown),
      rollback_pointer_ready: false,
      dry_run_id: mode === "dry_run" ? dryRunId : null,
    };
  }

  if (mode === "activate" && options.ownerApproval !== true) {
    return {
      status: "blocked_no_owner_approval",
      mode,
      knowledge_bank_dir: dir,
      app_facts_source_path: appFactsSourcePath,
      structured_path: structuredPath,
      routing_rules_path: routingRulesPath,
      app_fact_count: facts.length,
      structured_hash: null,
      routing_rules_hash: null,
      manifest_path: manifestPath,
      manifest_hash: null,
      source_hash: sha256(markdown),
      rollback_pointer_ready: false,
      dry_run_id: null,
    };
  }

  const structuredJson = buildStructuredJson(facts);
  const routingRules = buildRoutingRules(facts);
  const targetDir = mode === "dry_run" ? resolve(dir, "structured_publish_dry_runs", dryRunId) : dir;
  const targetStructuredPath = resolve(targetDir, "app_facts_structured.json");
  const targetRoutingRulesPath = resolve(targetDir, "app_routing_rules.md");
  const targetManifestPath = resolve(targetDir, "structured_knowledge_manifest.json");
  mkdirSync(dirname(targetStructuredPath), { recursive: true });
  atomicWrite(targetStructuredPath, structuredJson);
  atomicWrite(targetRoutingRulesPath, routingRules);
  const previousManifest = existsSync(manifestPath) ? readFileSync(manifestPath, "utf8") : "";
  const manifest = JSON.stringify({version:"1.0",generated_at:new Date().toISOString(),source_file:"app_facts.md",
    structured_file:"app_facts_structured.json",routing_rules_file:"app_routing_rules.md",app_fact_count:facts.length,
    source_hash:sha256(markdown), structured_hash:sha256(structuredJson),routing_rules_hash:sha256(routingRules),
    previous_manifest_hash: previousManifest ? sha256(previousManifest) : null,
    rollback_pointer_ready: previousManifest.length > 0 || mode === "dry_run",
    activation_mode: mode},null,2)+"\n";
  atomicWrite(targetManifestPath, manifest);
  if (mode === "activate") {
    const rollbackPath = resolve(dir, "structured_knowledge_rollback.json");
    atomicWrite(rollbackPath, `${JSON.stringify({ previous_manifest_hash: previousManifest ? sha256(previousManifest) : null, candidate_manifest_hash: sha256(manifest), rollback_ready: true }, null, 2)}\n`);
  }

  return {
    status: mode === "dry_run" ? "dry_run" : "published",
    mode,
    knowledge_bank_dir: dir,
    app_facts_source_path: appFactsSourcePath,
    structured_path: targetStructuredPath,
    routing_rules_path: targetRoutingRulesPath,
    app_fact_count: facts.length,
    structured_hash: sha256(structuredJson),
    routing_rules_hash: sha256(routingRules),
    manifest_path: targetManifestPath,
    manifest_hash: sha256(manifest),
    source_hash: sha256(markdown),
    rollback_pointer_ready: previousManifest.length > 0 || mode === "dry_run",
    dry_run_id: mode === "dry_run" ? dryRunId : null,
  };
}
