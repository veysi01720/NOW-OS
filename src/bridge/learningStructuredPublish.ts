import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { LearningSuggestion } from "../storage/ingestionTypes.js";

export type LearningPublishStatus = "dry_run_created" | "activated" | "rejected" | "blocked";
export interface LearningPublishResult { status: LearningPublishStatus; reason_code?: string; dry_run_id?: string; bundle_hash?: string; activation_token?: string; rollback_ready?: boolean; }

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const safeType = (suggestion: LearningSuggestion) => suggestion.proposed_knowledge_type === "app_fact_candidate";
const dirFor = (dir?: string) => resolve(dir ?? process.env.KNOWLEDGE_BANK_DIR ?? resolve("data", "knowledge_bank"));
const atomicWrite = (path: string, content: string) => { mkdirSync(dirname(path), { recursive: true }); const tmp = `${path}.tmp-${process.pid}`; writeFileSync(tmp, content, { encoding: "utf8", mode: 0o600 }); renameSync(tmp, path); };

interface ActivationRecord { token: string; suggestion_id: string; dry_run_id: string; bundle_hash: string; expires_at: string; used: boolean; }

function activationPath(dir: string) { return resolve(dir, "learning_publish_approvals.json"); }
function readApprovals(path: string): ActivationRecord[] { try { const value = JSON.parse(readFileSync(path, "utf8")) as unknown; return Array.isArray(value) ? value as ActivationRecord[] : []; } catch { return []; } }

function parseFact(suggestion: LearningSuggestion): Record<string, unknown> | null {
  try {
    const value = JSON.parse(suggestion.proposed_text) as Record<string, unknown>;
    if (!value || typeof value !== "object" || typeof value.app !== "string" || typeof value.android_name !== "string" || typeof value.ios_name !== "string") return null;
    if (value.status !== "owner_approved") return null;
    return value;
  } catch { return null; }
}

export function createLearningFactDryRun(suggestion: LearningSuggestion, knowledgeBankDir?: string, now = new Date()): LearningPublishResult {
  if (!safeType(suggestion)) return { status: "rejected", reason_code: "LEARNING_TYPE_NOT_APP_FACT_CANDIDATE" };
  const fact = parseFact(suggestion);
  if (!fact) return { status: "blocked", reason_code: "APP_FACT_SCHEMA_INVALID" };
  const dir = dirFor(knowledgeBankDir);
  const dryRunId = `learning_${suggestion.short_ref ?? suggestion.suggestion_id}_${now.getTime()}`;
  const bundle = JSON.stringify({ version: "1.0", source: "approved_learning_suggestion", app_facts: [fact] }, null, 2) + "\n";
  const bundleHash = hash(bundle);
  const manifest = JSON.stringify({ dry_run_id: dryRunId, suggestion_id: suggestion.suggestion_id, source_ref: suggestion.short_ref ?? null, bundle_hash: bundleHash, schema_valid: true, risk_count: 0, conflict_count: 0, active_knowledge_modified: false, owner_activation_required: true }, null, 2) + "\n";
  const token = `LPA-${randomBytes(8).toString("hex").toUpperCase()}`;
  const approvals = readApprovals(activationPath(dir));
  approvals.push({ token, suggestion_id: suggestion.suggestion_id, dry_run_id: dryRunId, bundle_hash: bundleHash, expires_at: new Date(now.getTime() + 20 * 60 * 1000).toISOString(), used: false });
  atomicWrite(resolve(dir, "structured_publish_dry_runs", dryRunId, "learning_app_facts.json"), bundle);
  atomicWrite(resolve(dir, "structured_publish_dry_runs", dryRunId, "manifest.json"), manifest);
  atomicWrite(activationPath(dir), JSON.stringify(approvals, null, 2) + "\n");
  return { status: "dry_run_created", dry_run_id: dryRunId, bundle_hash: bundleHash, activation_token: token, rollback_ready: true };
}

export function activateLearningFactDryRun(suggestion: LearningSuggestion, token: string, knowledgeBankDir?: string, now = new Date()): LearningPublishResult {
  if (!safeType(suggestion)) return { status: "rejected", reason_code: "LEARNING_TYPE_NOT_APP_FACT_CANDIDATE" };
  const dir = dirFor(knowledgeBankDir);
  const path = activationPath(dir);
  const approvals = readApprovals(path);
  const approval = approvals.find((item) => item.token === token && item.suggestion_id === suggestion.suggestion_id && !item.used);
  if (!approval || new Date(approval.expires_at).getTime() <= now.getTime()) return { status: "blocked", reason_code: "OWNER_ACTIVATION_INVALID_OR_EXPIRED" };
  const dryPath = resolve(dir, "structured_publish_dry_runs", approval.dry_run_id, "learning_app_facts.json");
  const manifestPath = resolve(dir, "structured_publish_dry_runs", approval.dry_run_id, "manifest.json");
  if (!existsSync(dryPath) || !existsSync(manifestPath)) return { status: "blocked", reason_code: "DRY_RUN_SOURCE_MISSING" };
  const bundle = readFileSync(dryPath, "utf8");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { bundle_hash?: string; schema_valid?: boolean; risk_count?: number; conflict_count?: number };
  if (hash(bundle) !== approval.bundle_hash || manifest.bundle_hash !== approval.bundle_hash || manifest.schema_valid !== true || manifest.risk_count !== 0 || manifest.conflict_count !== 0) {
    return { status: "blocked", reason_code: "HASH_SCHEMA_RISK_CONFLICT_GATE_FAILED" };
  }
  const parsed = JSON.parse(bundle) as { app_facts: Record<string, unknown>[] };
  const activePath = resolve(dir, "app_facts_structured.json");
  const rollbackPath = resolve(dir, "app_facts_structured.rollback.json");
  const previous = existsSync(activePath) ? readFileSync(activePath, "utf8") : "";
  atomicWrite(rollbackPath, JSON.stringify({ previous_hash: previous ? hash(previous) : null, previous_content: previous, rollback_ready: true }, null, 2) + "\n");
  const active = previous ? JSON.parse(previous) as { app_facts?: Record<string, unknown>[]; [key: string]: unknown } : { version: "1.0", app_facts: [] };
  active.app_facts = [...(active.app_facts ?? []), ...parsed.app_facts];
  atomicWrite(activePath, JSON.stringify(active, null, 2) + "\n");
  approval.used = true;
  atomicWrite(path, JSON.stringify(approvals, null, 2) + "\n");
  return { status: "activated", dry_run_id: approval.dry_run_id, bundle_hash: approval.bundle_hash, rollback_ready: true };
}

export function rollbackLearningFactPublish(knowledgeBankDir?: string): boolean {
  const dir = dirFor(knowledgeBankDir);
  const rollbackPath = resolve(dir, "app_facts_structured.rollback.json");
  if (!existsSync(rollbackPath)) return false;
  try {
    const rollback = JSON.parse(readFileSync(rollbackPath, "utf8")) as { previous_content?: string };
    if (typeof rollback.previous_content !== "string") return false;
    atomicWrite(resolve(dir, "app_facts_structured.json"), rollback.previous_content);
    return true;
  } catch {
    return false;
  }
}
