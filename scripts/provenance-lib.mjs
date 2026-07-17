import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

export const PROVENANCE_SCHEMA_VERSION = "1.0";

const SOURCE_ROOT_FILES = [
  ".dockerignore",
  "Dockerfile",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vitest.config.ts",
  "workspace.identity.json",
];

const SOURCE_ROOT_DIRS = ["src", "docs", "scripts"];

function toPosix(value) {
  return value.split(sep).join("/");
}

export function sha256Buffer(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256File(path) {
  return sha256Buffer(readFileSync(path));
}

function walkFiles(root, directory) {
  const absolute = resolve(root, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = resolve(absolute, entry.name);
    const rel = toPosix(relative(root, child));
    if (entry.isDirectory()) return walkFiles(root, rel);
    if (entry.isFile()) return [rel];
    return [];
  });
}

export function collectSourceFiles(root) {
  const files = SOURCE_ROOT_FILES.filter((path) => existsSync(resolve(root, path)));
  for (const directory of SOURCE_ROOT_DIRS) files.push(...walkFiles(root, directory));
  return [...new Set(files)].sort((a, b) => a.localeCompare(b, "en"));
}

export function collectDirectoryFiles(root, directory) {
  return walkFiles(root, directory).sort((a, b) => a.localeCompare(b, "en"));
}

export function hashFileSet(root, paths) {
  const entries = paths.map((path) => {
    const absolute = resolve(root, path);
    return {
      path: toPosix(path),
      sha256: sha256File(absolute),
      size: statSync(absolute).size,
    };
  });
  const aggregate = createHash("sha256");
  for (const entry of entries) {
    aggregate.update(entry.path);
    aggregate.update("\0");
    aggregate.update(entry.sha256);
    aggregate.update("\0");
    aggregate.update(String(entry.size));
    aggregate.update("\n");
  }
  return { hash: aggregate.digest("hex"), entries };
}

export function buildProvenanceData(root, testResultReference, generatedAt = new Date().toISOString()) {
  const identityPath = resolve(root, "workspace.identity.json");
  const lockPath = resolve(root, "package-lock.json");
  const distServerPath = resolve(root, "dist", "server.js");
  if (!existsSync(identityPath)) throw new Error("WORKSPACE_IDENTITY_MISSING");
  if (!existsSync(lockPath)) throw new Error("PACKAGE_LOCK_MISSING");
  if (!existsSync(distServerPath)) throw new Error("DIST_SERVER_MISSING");

  const identity = JSON.parse(readFileSync(identityPath, "utf8"));
  if (identity.workspace_role !== "CANONICAL_PRODUCTION_SOURCE") {
    throw new Error("NON_CANONICAL_WORKSPACE");
  }
  if (identity.service_name !== "now_os_backend") throw new Error("SERVICE_IDENTITY_MISMATCH");
  if (!/^[A-Za-z0-9._:-]+$/.test(testResultReference)) {
    throw new Error("INVALID_TEST_RESULT_REFERENCE");
  }

  const source = hashFileSet(root, collectSourceFiles(root));
  const dist = hashFileSet(root, collectDirectoryFiles(root, "dist"));
  return {
    schema_version: PROVENANCE_SCHEMA_VERSION,
    generated_at: generatedAt,
    workspace_id: identity.workspace_id,
    workspace_role: identity.workspace_role,
    compose_project: identity.compose_project,
    service_name: identity.service_name,
    expected_command: identity.expected_command,
    source_tree_hash: source.hash,
    package_lock_hash: sha256File(lockPath),
    dist_tree_hash: dist.hash,
    workspace_identity_hash: sha256File(identityPath),
    test_result_reference: testResultReference,
    source_file_count: source.entries.length,
    dist_file_count: dist.entries.length,
    source_files: source.entries,
    dist_files: dist.entries,
    exclusions: [".env", "data", "backups", "node_modules", "dist-from-source-hash", "build/provenance"],
  };
}

export function verifyProvenanceData(root, manifest) {
  const reasons = [];
  if (manifest.schema_version !== PROVENANCE_SCHEMA_VERSION) reasons.push("SCHEMA_VERSION_MISMATCH");
  const currentSource = hashFileSet(root, collectSourceFiles(root));
  const currentDist = hashFileSet(root, collectDirectoryFiles(root, "dist"));
  if (manifest.source_tree_hash !== currentSource.hash) reasons.push("SOURCE_TREE_HASH_MISMATCH");
  if (manifest.package_lock_hash !== sha256File(resolve(root, "package-lock.json"))) reasons.push("PACKAGE_LOCK_HASH_MISMATCH");
  if (manifest.dist_tree_hash !== currentDist.hash) reasons.push("DIST_TREE_HASH_MISMATCH");
  if (manifest.workspace_identity_hash !== sha256File(resolve(root, "workspace.identity.json"))) reasons.push("WORKSPACE_IDENTITY_HASH_MISMATCH");
  if (manifest.source_file_count !== currentSource.entries.length) reasons.push("SOURCE_FILE_COUNT_MISMATCH");
  if (manifest.dist_file_count !== currentDist.entries.length) reasons.push("DIST_FILE_COUNT_MISMATCH");
  return { ok: reasons.length === 0, reason_codes: reasons };
}
