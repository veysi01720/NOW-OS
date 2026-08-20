import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ActionAuditStore } from "../store/actionAuditStore.js";
import type { ZipIngestionJobRecord, ZipLearningCandidateRecord, OwnerKnowledgeClassification } from "./zipIngestion/types.js";
import type { ZipIngestionStore } from "./zipIngestion/store.js";
import { publishStructuredKnowledgeSources } from "./structuredKnowledgePublish.js";
import { loadStructuredAppFacts } from "./structuredAppFacts.js";
import { defaultUserState } from "../storage/types.js";
import { resolveCandidatePolicy } from "../intelligence/candidate/CandidatePolicyResolver.js";

export interface OwnerKnowledgeReviewSummary {
  job_id: string;
  source_archive_hash_masked: string;
  detected_sections: Array<{
    candidate_id: string;
    section_id: string;
    title: string;
    classification: OwnerKnowledgeClassification;
    target_file: string;
    source_hash: string;
    conflict_warnings: string[];
    status: string;
  }>;
  active_claim: false;
}

export interface OwnerKnowledgeMaterializationResult {
  status: "published" | "failed" | "no_approved_sections";
  job_id: string;
  approved_section_ids: string[];
  rejected_section_ids: string[];
  active_version_hash_masked: string | null;
  fact_count: number;
  activation_status: "published_active" | "failed_previous_version_preserved" | "not_started";
  rollback_pointer: string | null;
  verification?: {
    source_present: boolean;
    structured_fields: string[];
    context_paths: string[];
    failures: string[];
  };
  error_code?: string;
}

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const maskHash = (value: string | null) => value ? `${value.slice(0, 12)}…` : null;

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tmp, content, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
}

function maskedArchiveHash(job: ZipIngestionJobRecord): string { return maskHash(job.zip_sha256) ?? "unknown"; }

function conflictWarnings(candidate: ZipLearningCandidateRecord): string[] {
  const warnings: string[] = [];
  if ((candidate.risk_flags ?? []).length > 0) warnings.push(...(candidate.risk_flags ?? []));
  if ((candidate.conflict_flags ?? []).length > 0) warnings.push(...(candidate.conflict_flags ?? []));
  if (candidate.classification === "archive") warnings.push("archive_only");
  if (/garanti\s+kazan|kesin\s+kazan|mutlaka\s+kazan/i.test(candidate.extracted_text)) warnings.push("risky_earnings_language");
  if (/https?:\/\//i.test(candidate.extracted_text) && candidate.candidate_type === "link_candidate") warnings.push("unverified_link");
  return warnings;
}

function verifyMaterializedKnowledge(
  appFactsPath: string,
  structuredPath: string,
  approved: ZipLearningCandidateRecord[],
  forceStructuredVerificationFailure = false,
): OwnerKnowledgeMaterializationResult["verification"] {
  const source = readFileSync(appFactsPath, "utf8");
  const parsed = JSON.parse(readFileSync(structuredPath, "utf8")) as Record<string, unknown>;
  const structuredFields = new Set<string>();
  const contextPaths = new Set<string>();
  const failures: string[] = [];
  const structuredSections = Array.isArray(parsed.owner_transfer_sections) ? parsed.owner_transfer_sections : [];
  const policySections = parsed.policy_sections && typeof parsed.policy_sections === "object" ? parsed.policy_sections as Record<string, unknown> : {};
  const loaded = loadStructuredAppFacts(resolve(appFactsPath, ".."));
  const stageProbes: Array<{
    stage: string;
    intent: string;
    state: ReturnType<typeof defaultUserState>;
  }> = [
    { stage: "intake", intent: "ask_eligibility", state: { ...defaultUserState(), current_state: "NEW_LEAD" } },
    { stage: "app_selection", intent: "app_selection", state: { ...defaultUserState(), current_state: "WAITING_FOR_APP" } },
    { stage: "installation", intent: "technical_issue", state: { ...defaultUserState(), current_state: "INSTALLATION_IN_PROGRESS" } },
    { stage: "training", intent: "training_guidance", state: { ...defaultUserState(), current_state: "TRAINING_READY" } },
  ];

  for (const candidate of approved) {
    const content = candidate.extracted_text.trim();
    if (!source.includes(content)) {
      failures.push(`SOURCE_MISSING:${candidate.section_id ?? candidate.id}`);
      continue;
    }
    let field: string | null = null;
    if (!forceStructuredVerificationFailure && structuredSections.some((item) => item && typeof item === "object" && String((item as Record<string, unknown>).content ?? "").includes(content))) {
      field = "owner_transfer_sections";
    } else if (!forceStructuredVerificationFailure) {
      const policyKey = Object.keys(policySections).find((key) => String(policySections[key] ?? "").includes(content));
      if (policyKey) field = `policy_sections.${policyKey}`;
    }
    if (!field) {
      failures.push(`STRUCTURED_MISSING:${candidate.section_id ?? candidate.id}`);
      continue;
    }
    structuredFields.add(field);
    const contextPresent = field === "owner_transfer_sections"
      ? loaded.owner_transfer_sections.some((item) => item.content.includes(content))
      : field.startsWith("policy_sections.") && loaded.policy_sections !== null && String(loaded.policy_sections[field.slice("policy_sections.".length) as keyof NonNullable<typeof loaded.policy_sections>] ?? "").includes(content);
    if (contextPresent) contextPaths.add(`structured_facts.${field}`);
    else failures.push(`CONTEXT_MISSING:${candidate.section_id ?? candidate.id}`);
    const matchingStages = stageProbes.filter((probe) => {
      const decisionContext = resolveCandidatePolicy(probe.state, [], loaded.app_facts, loaded.general_work_model, probe.intent, loaded.policy_sections, loaded.owner_transfer_sections);
      return decisionContext.facts.some((fact) => fact.content.includes(content));
    });
    for (const probe of matchingStages) contextPaths.add(`decision_context.canonical_policy_facts:${probe.stage}:${probe.intent}`);
    if (matchingStages.length === 0) failures.push(`DECISION_CONTEXT_MISSING:${candidate.section_id ?? candidate.id}`);
  }

  return { source_present: failures.every((failure) => !failure.startsWith("SOURCE_MISSING:")), structured_fields: [...structuredFields], context_paths: [...contextPaths], failures };
}

export function buildOwnerKnowledgeReviewSummary(job: ZipIngestionJobRecord, candidates: ZipLearningCandidateRecord[]): OwnerKnowledgeReviewSummary {
  return {
    job_id: job.id,
    source_archive_hash_masked: maskedArchiveHash(job),
    detected_sections: candidates.map((candidate) => ({
      candidate_id: candidate.id,
      section_id: candidate.section_id ?? candidate.id,
      title: candidate.section_title ?? candidate.id,
      classification: candidate.classification ?? "information",
      target_file: candidate.target_file ?? "app_facts.md",
      source_hash: maskHash(candidate.section_hash ?? sha256(candidate.extracted_text)) ?? "unknown",
      conflict_warnings: conflictWarnings(candidate),
      status: candidate.status,
    })),
    active_claim: false,
  };
}

export function persistOwnerKnowledgeReviewSummary(job: ZipIngestionJobRecord, candidates: ZipLearningCandidateRecord[], dataDir?: string): OwnerKnowledgeReviewSummary {
  const summary = buildOwnerKnowledgeReviewSummary(job, candidates);
  const path = resolve(dataDir ?? resolve("data"), "zip_ingestion", job.id, "owner_review_summary.json");
  atomicWrite(path, `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

export function materializeApprovedOwnerKnowledge(input: {
  jobId: string;
  zipStore: ZipIngestionStore;
  knowledgeBankDir?: string;
  actionAuditStore?: ActionAuditStore;
  actorRole?: "owner" | "manager";
  forceHashFailure?: boolean;
  forceStructuredVerificationFailure?: boolean;
}): OwnerKnowledgeMaterializationResult {
  const job = input.zipStore.getJob(input.jobId);
  if (!job) return { status: "failed", job_id: input.jobId, approved_section_ids: [], rejected_section_ids: [], active_version_hash_masked: null, fact_count: 0, activation_status: "failed_previous_version_preserved", rollback_pointer: null, error_code: "JOB_NOT_FOUND" };
  const candidates = input.zipStore.listLearningCandidates(input.jobId);
  const approved = candidates.filter((candidate) => candidate.status === "approved_for_bundle" && candidate.classification !== "archive");
  const rejected = candidates.filter((candidate) => candidate.status === "rejected" || candidate.classification === "archive").map((candidate) => candidate.section_id ?? candidate.id);
  if (approved.length === 0) return { status: "no_approved_sections", job_id: input.jobId, approved_section_ids: [], rejected_section_ids: rejected, active_version_hash_masked: null, fact_count: 0, activation_status: "not_started", rollback_pointer: null };

  const dir = resolve(input.knowledgeBankDir ?? process.env.KNOWLEDGE_BANK_DIR ?? resolve("data", "knowledge_bank"));
  const appFactsPath = resolve(dir, "app_facts.md");
  const previous = existsSync(appFactsPath) ? readFileSync(appFactsPath, "utf8") : "";
  const structuredPath = resolve(dir, "app_facts_structured.json");
  const manifestPath = resolve(dir, "structured_knowledge_manifest.json");
  const routingPath = resolve(dir, "app_routing_rules.md");
  const previousStructured = existsSync(structuredPath) ? readFileSync(structuredPath, "utf8") : null;
  const previousManifest = existsSync(manifestPath) ? readFileSync(manifestPath, "utf8") : null;
  const previousRouting = existsSync(routingPath) ? readFileSync(routingPath, "utf8") : null;
  const previousHash = sha256(previous);
  const timestamp = Date.now();
  const backupPath = `${appFactsPath}.backup-owner-transfer-${timestamp}`;
  const rollbackPath = resolve(dir, "owner_knowledge_transfer_rollback.json");
  let sourceHashes: Array<{ section_id: string; section_hash: string }> = [];
  try {
    sourceHashes = approved.map((candidate) => {
      const actual = sha256(candidate.extracted_text);
      const expected = candidate.section_hash ?? actual;
      if (input.forceHashFailure || actual !== expected) throw new Error("OWNER_TRANSFER_SECTION_HASH_MISMATCH");
      return { section_id: candidate.section_id ?? candidate.id, section_hash: actual };
    });
    mkdirSync(dirname(backupPath), { recursive: true });
    writeFileSync(backupPath, previous, { encoding: "utf8", mode: 0o600 });
    const additions = approved
      .filter((candidate) => !previous.includes(candidate.extracted_text.trim()))
      .map((candidate) => `\n\n## Owner Transfer [${candidate.classification ?? "information"}]: ${candidate.section_title ?? candidate.section_id ?? candidate.id}\n\n${candidate.extracted_text.trim()}\n`)
      .join("");
    atomicWrite(appFactsPath, `${previous.trimEnd()}${additions}\n`);
    const publish = publishStructuredKnowledgeSources({ knowledgeBankDir: dir, mode: "activate", ownerApproval: true });
    if (publish.status !== "published") throw new Error(`OWNER_TRANSFER_PUBLISH_${publish.status.toUpperCase()}`);
    const previouslyPublished = input.zipStore.listLearningCandidates()
      .filter((candidate) => candidate.status === "published" && candidate.target_file === "app_facts.md" && candidate.classification !== "archive");
    const verificationCandidates = [...previouslyPublished, ...approved]
      .filter((candidate, index, candidates) => candidates.findIndex((item) => item.id === candidate.id) === index);
    const verification = verifyMaterializedKnowledge(appFactsPath, structuredPath, verificationCandidates, input.forceStructuredVerificationFailure);
    if (!verification || verification.failures.length > 0) throw new Error(`OWNER_TRANSFER_VERIFY_${verification?.failures.join(",") ?? "MISSING"}`);
    const rollback = { previous_source_hash: previousHash, backup_path: backupPath, created_at: new Date().toISOString(), source_archive_hash: job.zip_sha256, section_hashes: sourceHashes };
    atomicWrite(rollbackPath, `${JSON.stringify(rollback, null, 2)}\n`);
    const result: OwnerKnowledgeMaterializationResult = { status: "published", job_id: job.id, approved_section_ids: sourceHashes.map((item) => item.section_id), rejected_section_ids: rejected, active_version_hash_masked: maskHash(publish.structured_hash), fact_count: publish.app_fact_count, activation_status: "published_active", rollback_pointer: backupPath, verification };
    input.zipStore.markLearningCandidatesPublished(approved.map((candidate) => candidate.id));
    atomicWrite(resolve(dir, "owner_knowledge_transfer_audit.json"), `${JSON.stringify({ ...result, active_version_hash_masked: result.active_version_hash_masked, source_archive_hash_masked: maskedArchiveHash(job), source_hash: maskHash(publish.source_hash), manifest_hash: maskHash(publish.manifest_hash), durable: true, created_at: new Date().toISOString() }, null, 2)}\n`);
    const actorRole = input.actorRole ?? "owner";
    input.actionAuditStore?.logAction({ action_type: "owner_knowledge_transfer_published", actor_role: actorRole, actor_masked_ref: "authenticated-owner", role_resolution_source: actorRole === "manager" ? "manager_token" : "owner_token", target_type: "learning", target_safe_ref: job.id, risk_level: "HIGH", confirm_required: true, confirmed: true, result_status: "success", new_status: "published_active", sanitized_reason: JSON.stringify({ approved_section_ids: result.approved_section_ids, rejected_section_ids: result.rejected_section_ids, active_version_hash_masked: result.active_version_hash_masked, fact_count: result.fact_count, rollback_pointer: backupPath }) });
    return result;
  } catch (error) {
    atomicWrite(appFactsPath, previous);
    for (const [path, content] of [[structuredPath, previousStructured], [manifestPath, previousManifest], [routingPath, previousRouting]] as Array<[string, string | null]>) {
      if (content === null) {
        if (existsSync(path)) unlinkSync(path);
      } else {
        atomicWrite(path, content);
      }
    }
    const code = error instanceof Error ? error.message : "OWNER_TRANSFER_FAILED";
    const actorRole = input.actorRole ?? "owner";
    input.actionAuditStore?.logAction({ action_type: "owner_knowledge_transfer_failed", actor_role: actorRole, actor_masked_ref: "authenticated-owner", role_resolution_source: actorRole === "manager" ? "manager_token" : "owner_token", target_type: "learning", target_safe_ref: job.id, risk_level: "HIGH", confirm_required: true, confirmed: true, result_status: "failure", error_safe_message: code, new_status: "failed_previous_version_preserved" });
    return { status: "failed", job_id: job.id, approved_section_ids: [], rejected_section_ids: rejected, active_version_hash_masked: null, fact_count: 0, activation_status: "failed_previous_version_preserved", rollback_pointer: backupPath, error_code: code };
  }
}
