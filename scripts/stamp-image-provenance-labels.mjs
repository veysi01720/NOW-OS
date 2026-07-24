#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256File } from "./provenance-lib.mjs";

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function docker(args) {
  return execFileSync("docker", args, { encoding: "utf8" }).trim();
}

const image = argument("image");
const finalTag = argument("final-tag", image);
const manifestPathInImage = argument("manifest-path", "/app/build/provenance/source-manifest.json");

if (!image) {
  console.error("IMAGE_PROVENANCE_LABELED=NO reason=IMAGE_ARG_MISSING");
  process.exit(1);
}

let containerId;
let tempDir;
try {
  containerId = docker(["create", image]);
  tempDir = mkdtempSync(join(tmpdir(), "now-os-provenance-stamp-"));
  const localManifestPath = join(tempDir, "source-manifest.json");
  docker(["cp", `${containerId}:${manifestPathInImage}`, localManifestPath]);

  const manifest = JSON.parse(readFileSync(localManifestPath, "utf8"));
  const manifestHash = sha256File(localManifestPath);

  const requiredFields = [
    "source_tree_hash",
    "package_lock_hash",
    "dist_tree_hash",
    "workspace_identity_hash",
  ];
  for (const field of requiredFields) {
    if (typeof manifest[field] !== "string" || manifest[field] === "") {
      throw new Error(`MANIFEST_FIELD_MISSING:${field}`);
    }
  }

  const labelChange =
    `LABEL now_os.source_tree_hash=${manifest.source_tree_hash} ` +
    `now_os.package_lock_hash=${manifest.package_lock_hash} ` +
    `now_os.dist_tree_hash=${manifest.dist_tree_hash} ` +
    `now_os.workspace_identity_hash=${manifest.workspace_identity_hash} ` +
    `now_os.provenance_manifest_hash=${manifestHash}`;

  docker(["commit", "--change", labelChange, containerId, finalTag]);

  console.log(
    `IMAGE_PROVENANCE_LABELED=YES image=${finalTag} ` +
    `source_tree_hash=${manifest.source_tree_hash} ` +
    `package_lock_hash=${manifest.package_lock_hash} ` +
    `dist_tree_hash=${manifest.dist_tree_hash} ` +
    `workspace_identity_hash=${manifest.workspace_identity_hash} ` +
    `provenance_manifest_hash=${manifestHash}`
  );
} catch (error) {
  console.error(`IMAGE_PROVENANCE_LABELED=NO reason=${error instanceof Error ? error.message : "UNKNOWN"}`);
  process.exitCode = 1;
} finally {
  if (containerId) {
    try {
      docker(["rm", containerId]);
    } catch {
      // Best-effort cleanup only; the main result was already reported above.
    }
  }
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
