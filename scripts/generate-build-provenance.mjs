#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildProvenanceData, sha256File } from "./provenance-lib.mjs";

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const root = resolve(argument("root", process.cwd()));
const output = resolve(root, argument("output", "build/provenance/source-manifest.json"));
const testResult = argument("test-result", process.env.NOW_OS_TEST_RESULT_REFERENCE ?? "tests-not-recorded");
const generatedAt = argument("generated-at", new Date().toISOString());

try {
  const manifest = buildProvenanceData(root, testResult, generatedAt);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const manifestHash = sha256File(output);
  writeFileSync(`${output}.sha256`, `${manifestHash}  ${output.split(/[\\/]/).at(-1)}\n`, "utf8");
  console.log(`PROVENANCE_GENERATED=YES source_tree_hash=${manifest.source_tree_hash} package_lock_hash=${manifest.package_lock_hash} dist_tree_hash=${manifest.dist_tree_hash} workspace_identity_hash=${manifest.workspace_identity_hash} manifest_hash=${manifestHash}`);
} catch (error) {
  console.error(`PROVENANCE_GENERATED=NO reason=${error instanceof Error ? error.message : "UNKNOWN"}`);
  process.exit(1);
}
