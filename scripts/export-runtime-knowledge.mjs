#!/usr/bin/env node
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const args = process.argv.slice(2);
function value(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const source = resolve(value("--source") ?? process.env.KNOWLEDGE_BANK_DIR ?? "data/knowledge_bank");
const target = resolve(value("--target") ?? "data/knowledge_bank");
const backupRoot = resolve(value("--backup-dir") ?? "outputs/runtime_knowledge_snapshots");
const confirmed = args.includes("--confirm");

if (!confirmed) {
  console.error("Refusing export: add --confirm to perform the manual runtime-to-git snapshot.");
  process.exit(2);
}
if (source === target) {
  console.error("Refusing export: source and target must be different.");
  process.exit(2);
}
if (!existsSync(resolve(source, "app_facts.md"))) {
  console.error(`Runtime source is missing app_facts.md: ${source}`);
  process.exit(1);
}

const files = [
  "app_facts.md",
  "app_facts_structured.json",
  "app_routing_rules.md",
  "structured_knowledge_manifest.json",
  "structured_knowledge_rollback.json",
  "owner_knowledge_transfer_rollback.json",
  "owner_knowledge_transfer_audit.json",
];
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = resolve(backupRoot, timestamp);
const stagingDir = resolve(dirname(target), `.runtime-knowledge-export-${process.pid}-${Date.now()}`);
mkdirSync(backupDir, { recursive: true });
mkdirSync(stagingDir, { recursive: true });

const hashes = {};
for (const file of files) {
  const sourcePath = resolve(source, file);
  if (!existsSync(sourcePath)) continue;
  const content = readFileSync(sourcePath);
  hashes[file] = createHash("sha256").update(content).digest("hex");
  const targetPath = resolve(stagingDir, file);
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, content, { mode: 0o600 });
  const existingTarget = resolve(target, file);
  if (existsSync(existingTarget)) cpSync(existingTarget, resolve(backupDir, file));
}

const trainingSource = resolve(source, "owner_approved_training");
if (existsSync(trainingSource)) {
  cpSync(trainingSource, resolve(stagingDir, "owner_approved_training"), { recursive: true });
  cpSync(trainingSource, resolve(backupDir, "owner_approved_training"), { recursive: true, force: true });
}

mkdirSync(target, { recursive: true });
for (const file of files) {
  const staged = resolve(stagingDir, file);
  if (!existsSync(staged)) continue;
  const destination = resolve(target, file);
  const temporary = `${destination}.tmp-${process.pid}`;
  cpSync(staged, temporary);
  renameSync(temporary, destination);
}
if (existsSync(resolve(stagingDir, "owner_approved_training"))) {
  cpSync(resolve(stagingDir, "owner_approved_training"), resolve(target, "owner_approved_training"), { recursive: true, force: true });
}

const manifest = {
  export_type: "manual_runtime_to_git_snapshot",
  source_runtime_dir: basename(source),
  target_git_dir: target,
  created_at: new Date().toISOString(),
  source_mtime: statSync(resolve(source, "app_facts.md")).mtime.toISOString(),
  files: hashes,
  automatic_commit: false,
  automatic_push: false,
};
writeFileSync(resolve(backupDir, "snapshot-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ status: "exported", source, target, backup_dir: backupDir, files: Object.keys(hashes), automatic_commit: false, automatic_push: false }, null, 2));
