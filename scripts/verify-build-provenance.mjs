#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { verifyProvenanceData } from "./provenance-lib.mjs";

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const root = resolve(argument("root", process.cwd()));
const manifestPath = resolve(root, argument("manifest", "build/provenance/source-manifest.json"));

try {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const result = verifyProvenanceData(root, manifest);
  const expected = [
    ["source", argument("expected-source")],
    ["lock", argument("expected-lock")],
    ["dist", argument("expected-dist")],
    ["workspace", argument("expected-workspace")],
  ];
  const fieldByName = {
    source: "source_tree_hash",
    lock: "package_lock_hash",
    dist: "dist_tree_hash",
    workspace: "workspace_identity_hash",
  };
  for (const [name, value] of expected) {
    if (value !== undefined && manifest[fieldByName[name]] !== value) {
      result.reason_codes.push(`EXPECTED_${name.toUpperCase()}_HASH_MISMATCH`);
    }
  }
  result.ok = result.reason_codes.length === 0;
  if (!result.ok) {
    console.error(`PROVENANCE_VERIFIED=NO reason_codes=${result.reason_codes.join(",")}`);
    process.exit(1);
  }
  console.log(`PROVENANCE_VERIFIED=YES source_tree_hash=${manifest.source_tree_hash} package_lock_hash=${manifest.package_lock_hash} dist_tree_hash=${manifest.dist_tree_hash} workspace_identity_hash=${manifest.workspace_identity_hash}`);
} catch (error) {
  console.error(`PROVENANCE_VERIFIED=NO reason=${error instanceof Error ? error.message : "UNKNOWN"}`);
  process.exit(1);
}
