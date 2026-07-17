import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { KNOWLEDGE_BUNDLE_FILES } from "./knowledgeBundle.js";
import { validateKnowledgeSourceIntegrity } from "./sourceIntegrity.js";
import type { ZipIngestionStore } from "./zipIngestion/store.js";
import type { ZipLearningCandidateRecord } from "./zipIngestion/types.js";

export interface ReviewPublishDryRunResult {
  dry_run_id: string;
  output_dir: string;
  bundle_path: string;
  manifest_path: string;
  bundle_hash: string;
  manifest: ReviewPublishDryRunManifest;
}

export interface ReviewPublishDryRunManifest {
  dry_run_id: string;
  created_at: string;
  approved_candidate_count: number;
  included_candidate_ids: string[];
  excluded_candidate_ids: string[];
  conflict_count: number;
  risk_flag_count: number;
  source_files_count: number;
  bundle_hash: string;
  knowledge_modified: false;
  vector_modified: false;
  openai_publish_triggered: false;
  ready_for_owner_publish_approval: boolean;
  source_integrity: ReturnType<typeof validateKnowledgeSourceIntegrity>;
  official_app_facts_preserved: boolean;
  link_catalog_preserved: boolean;
  owner_approved_training_included: boolean;
  official_source_gate: OfficialSourceGateResult;
  conflicts: Array<{ candidate_id: string; conflict_type: string; summary: string }>;
  risks: Array<{ candidate_id: string; risk_type: string; summary: string; guarded: boolean }>;
}

const APPROVED_STATUS = "approved_for_bundle";
const EXCLUDED_STATUSES = new Set(["pending_owner_review", "rejected", "needs_edit"]);
const MIN_OFFICIAL_SOURCE_BYTES = 120;
const PLACEHOLDER_PATTERNS = [
  /^# Source\s+This is a valid owner-approved source file with enough content to pass the tiny-file guard\.\s*$/i,
  /\bplaceholder\b/i,
  /\bfixture\b/i,
  /^MISSING$/m,
];

export interface OfficialSourceGateResult {
  pass: boolean;
  thin_or_placeholder_files: string[];
  app_routing_rules_present: boolean;
  messaging_only_routing_evidence_present: boolean;
  layla_routing_evidence_present: boolean;
  critical_app_facts_anchors_present: boolean;
  link_catalog_policy_present: boolean;
  owner_approved_training_preserved: boolean;
}

export function createApprovedReviewsDryRun(input: {
  zipStore: ZipIngestionStore;
  knowledgeBankDir?: string;
  outputRoot?: string;
  now?: Date;
}): ReviewPublishDryRunResult {
  const knowledgeBankDir = resolve(input.knowledgeBankDir ?? process.env.KNOWLEDGE_BANK_DIR ?? resolve(process.cwd(), "data", "knowledge_bank"));
  const outputRoot = resolve(input.outputRoot ?? resolve(process.cwd(), "data", "review_publish", "dry_runs"));
  const dryRunId = `dry_${(input.now ?? new Date()).toISOString().replace(/[:.]/g, "-")}_${randomUUID().slice(0, 8)}`;
  const outputDir = resolve(outputRoot, dryRunId);
  mkdirSync(outputDir, { recursive: true });

  const allCandidates = input.zipStore.listLearningCandidates();
  const approvedCandidates = allCandidates.filter((candidate) => candidate.status === APPROVED_STATUS);
  const excludedCandidateIds = allCandidates
    .filter((candidate) => EXCLUDED_STATUSES.has(candidate.status))
    .map((candidate) => candidate.id)
    .sort();

  const officialLayer = buildOfficialLayer(knowledgeBankDir);
  const reviewLayer = buildReviewLayer(approvedCandidates, knowledgeBankDir);
  const bundle = `${officialLayer}\n\n${reviewLayer.content}`.trim() + "\n";
  const bundleHash = sha256(bundle);

  const bundlePath = resolve(outputDir, "approved_reviews_dry_run_bundle.md");
  const manifestPath = resolve(outputDir, "manifest.json");
  writeFileSync(bundlePath, bundle, "utf8");

  const sourceIntegrity = validateKnowledgeSourceIntegrity({ knowledgeBankDir, fullBundleContent: bundle });
  const officialSourceGate = validateOfficialSourceGate(knowledgeBankDir);
  const manifest: ReviewPublishDryRunManifest = {
    dry_run_id: dryRunId,
    created_at: (input.now ?? new Date()).toISOString(),
    approved_candidate_count: approvedCandidates.length,
    included_candidate_ids: approvedCandidates.map((candidate) => candidate.id).sort(),
    excluded_candidate_ids: excludedCandidateIds,
    conflict_count: reviewLayer.conflicts.length,
    risk_flag_count: reviewLayer.risks.length,
    source_files_count: officialSourceFiles(knowledgeBankDir).length,
    bundle_hash: bundleHash,
    knowledge_modified: false,
    vector_modified: false,
    openai_publish_triggered: false,
    ready_for_owner_publish_approval:
      approvedCandidates.length > 0 &&
      sourceIntegrity.publish_allowed &&
      officialSourceGate.pass &&
      reviewLayer.risks.every((risk) => risk.guarded),
    source_integrity: sourceIntegrity,
    official_app_facts_preserved: sourceIntegrity.app_facts_official_values_present,
    link_catalog_preserved: sourceIntegrity.link_catalog_policy_present,
    owner_approved_training_included: sourceIntegrity.owner_approved_training_included,
    official_source_gate: officialSourceGate,
    conflicts: reviewLayer.conflicts,
    risks: reviewLayer.risks,
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return {
    dry_run_id: dryRunId,
    output_dir: outputDir,
    bundle_path: bundlePath,
    manifest_path: manifestPath,
    bundle_hash: bundleHash,
    manifest,
  };
}

function buildOfficialLayer(knowledgeBankDir: string): string {
  return officialSourceFiles(knowledgeBankDir).map((fileName) => {
    const filePath = resolve(knowledgeBankDir, fileName);
    const content = existsSync(filePath) ? readFileSync(filePath, "utf8").trim() : "MISSING";
    return `\n\n<!-- OFFICIAL_SOURCE_FILE: ${fileName} -->\n\n${content}\n`;
  }).join("").trim();
}

export function validateOfficialSourceGate(knowledgeBankDir: string): OfficialSourceGateResult {
  const thin_or_placeholder_files: string[] = [];
  for (const fileName of officialSourceFiles(knowledgeBankDir)) {
    const filePath = resolve(knowledgeBankDir, fileName);
    const content = existsSync(filePath) ? readFileSync(filePath, "utf8").trim() : "";
    if (
      Buffer.byteLength(content, "utf8") < MIN_OFFICIAL_SOURCE_BYTES ||
      PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(content))
    ) {
      thin_or_placeholder_files.push(fileName);
    }
  }

  const appRouting = readOptional(resolve(knowledgeBankDir, "app_routing_rules.md"));
  const appFacts = readOptional(resolve(knowledgeBankDir, "app_facts.md"));
  const linkCatalog = readOptional(resolve(knowledgeBankDir, "link_catalog.md"));
  const trainingDir = resolve(knowledgeBankDir, "owner_approved_training");

  const app_routing_rules_present = appRouting.trim().length >= MIN_OFFICIAL_SOURCE_BYTES;
  const messaging_only_routing_evidence_present =
    /Sadece\s+mesajla\S*mak/i.test(appRouting) &&
    /mesajla\S*ma/i.test(appRouting) &&
    /Layla/i.test(appRouting) &&
    /(kamera|y\S*z|text-only|y\S*z\s+g\S*stermek)/i.test(appRouting);
  const layla_routing_evidence_present = /Layla[\s\S]*(NIVI|NİVİ|NÄ°VÄ°|N\S?V\S?)/i.test(appRouting);
  const critical_app_facts_anchors_present =
    /Layla[\s\S]*(NIVI|NİVİ|NÄ°VÄ°|N\S?V\S?)[\s\S]*8UNHAWUFC/i.test(appFacts) &&
    /Linky[\s\S]*M9W5B8/i.test(appFacts) &&
    /TanChat[\s\S]*X3XREZ/i.test(appFacts) &&
    /Amar[\s\S]*Amar Lite[\s\S]*xvrgZkf6[\s\S]*10621/i.test(appFacts) &&
    /Soyo[\s\S]*3997/i.test(appFacts) &&
    /Timo[\s\S]*VVXVUD/i.test(appFacts);
  const link_catalog_policy_present =
    /Link uydurmak yasak/i.test(linkCatalog) &&
    /Generic store/i.test(linkCatalog) &&
    /fake|tahmini/i.test(linkCatalog);
  const owner_approved_training_preserved = existsSync(trainingDir)
    && readdirSync(trainingDir).filter((fileName) => fileName.endsWith(".md")).length >= 5;

  const pass =
    thin_or_placeholder_files.length === 0 &&
    app_routing_rules_present &&
    messaging_only_routing_evidence_present &&
    layla_routing_evidence_present &&
    critical_app_facts_anchors_present &&
    link_catalog_policy_present &&
    owner_approved_training_preserved;

  return {
    pass,
    thin_or_placeholder_files,
    app_routing_rules_present,
    messaging_only_routing_evidence_present,
    layla_routing_evidence_present,
    critical_app_facts_anchors_present,
    link_catalog_policy_present,
    owner_approved_training_preserved,
  };
}

function officialSourceFiles(knowledgeBankDir: string): string[] {
  const trainingDir = resolve(knowledgeBankDir, "owner_approved_training");
  const training = existsSync(trainingDir)
    ? readdirSync(trainingDir).filter((fileName) => fileName.endsWith(".md")).sort().map((fileName) => `owner_approved_training/${fileName}`)
    : [];
  return [...KNOWLEDGE_BUNDLE_FILES, ...training];
}

function buildReviewLayer(candidates: ZipLearningCandidateRecord[], knowledgeBankDir: string) {
  const appFacts = readOptional(resolve(knowledgeBankDir, "app_facts.md"));
  const linkCatalog = readOptional(resolve(knowledgeBankDir, "link_catalog.md"));
  const conflicts: ReviewPublishDryRunManifest["conflicts"] = [];
  const risks: ReviewPublishDryRunManifest["risks"] = [];
  const sections = candidates.map((candidate) => {
    for (const conflict of detectConflicts(candidate, appFacts, linkCatalog)) conflicts.push(conflict);
    for (const risk of detectRisks(candidate)) risks.push(risk);
    return [
      `## REVIEW_CANDIDATE ${candidate.id}`,
      `- candidate_type: ${candidate.candidate_type}`,
      `- source_job_id: ${candidate.source_job_id}`,
      `- source_entry_id: ${candidate.source_entry_id}`,
      `- status: ${candidate.status}`,
      `- link_candidate_policy: ${candidate.candidate_type === "link_candidate" ? "missing_link_until_officially_verified" : "not_link_candidate"}`,
      "",
      sanitizeForBundle(candidate.extracted_text),
    ].join("\n");
  });

  return {
    content: [
      "<!-- REVIEW_DRY_RUN_LAYER: approved_for_bundle candidates only -->",
      "# Approved Review Candidates Dry-Run Layer",
      "",
      "Official app_facts.md and link_catalog.md remain authoritative. Link candidates are not promoted to trusted links in this dry-run.",
      "",
      ...sections,
    ].join("\n"),
    conflicts,
    risks,
  };
}

function detectConflicts(candidate: ZipLearningCandidateRecord, appFacts: string, linkCatalog: string): ReviewPublishDryRunManifest["conflicts"] {
  const conflicts: ReviewPublishDryRunManifest["conflicts"] = [];
  const text = candidate.extracted_text;
  if (/Layla/i.test(text) && /iPhone/i.test(text) && !/N[İI]V[İI]/i.test(text)) {
    conflicts.push({ candidate_id: candidate.id, conflict_type: "official_app_fact_conflict", summary: "Candidate may conflict with official Layla iPhone value." });
  }
  if (/Linky/i.test(text) && /code|kod/i.test(text) && !/M9W5B8/i.test(text)) {
    conflicts.push({ candidate_id: candidate.id, conflict_type: "official_invite_code_conflict", summary: "Candidate may conflict with official Linky code." });
  }
  if (candidate.candidate_type === "link_candidate" && !linkCatalog.includes(candidate.id)) {
    conflicts.push({ candidate_id: candidate.id, conflict_type: "unverified_link_candidate", summary: "Link candidate is not present in official link catalog." });
  }
  if (appFacts && /official/i.test(appFacts) && candidate.candidate_type === "app_fact_candidate" && conflicts.length > 0) {
    return conflicts;
  }
  return conflicts;
}

function detectRisks(candidate: ZipLearningCandidateRecord): ReviewPublishDryRunManifest["risks"] {
  const risks: ReviewPublishDryRunManifest["risks"] = [];
  const text = candidate.extracted_text;
  if (/garanti\s+kazanç|garanti\s+kazan|kesin\s+kazan|mutlaka\s+kazan/i.test(text)) {
    risks.push({ candidate_id: candidate.id, risk_type: "risky_guarantee_language", summary: "Risky guarantee or earnings wording detected.", guarded: true });
  }
  if (/https?:\/\/\S+/i.test(text) && candidate.candidate_type === "link_candidate") {
    risks.push({ candidate_id: candidate.id, risk_type: "unverified_link", summary: "Link candidate kept as untrusted/missing until official approval.", guarded: true });
  }
  return risks;
}

function sanitizeForBundle(value: string): string {
  return value
    .replace(/@s\.whatsapp\.net/g, "[jid]")
    .replace(/@g\.us/g, "[group]")
    .replace(/(?<!\d)(?:\+?90|0)?5\d{2}\s?\d{3}\s?\d{2}\s?\d{2}(?!\d)/g, "905***")
    .replace(/sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}/g, "[secret]");
}

function readOptional(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function relativeOutputPath(path: string): string {
  return relative(process.cwd(), path).replaceAll("\\", "/");
}
