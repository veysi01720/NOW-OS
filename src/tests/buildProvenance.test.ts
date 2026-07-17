import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const created: string[] = [];

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "now-os-provenance-"));
  created.push(root);
  for (const dir of ["src", "docs", "scripts", "dist", "data"]) mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, "Dockerfile"), "FROM node:20-alpine\n");
  writeFileSync(join(root, ".dockerignore"), ".env\n");
  writeFileSync(join(root, "package.json"), '{"name":"fixture"}\n');
  writeFileSync(join(root, "package-lock.json"), '{"lockfileVersion":3}\n');
  writeFileSync(join(root, "tsconfig.json"), "{}\n");
  writeFileSync(join(root, "vitest.config.ts"), "export default {};\n");
  writeFileSync(join(root, "workspace.identity.json"), JSON.stringify({
    workspace_id: "canonical-now-os",
    workspace_role: "CANONICAL_PRODUCTION_SOURCE",
    compose_project: "deploy_package",
    service_name: "now_os_backend",
    expected_command: "node dist/server.js",
  }));
  writeFileSync(join(root, "src", "server.ts"), "export const ok = true;\n");
  writeFileSync(join(root, "docs", "seal.md"), "sealed\n");
  writeFileSync(join(root, "scripts", "fixture.mjs"), "export {};\n");
  writeFileSync(join(root, "dist", "server.js"), "export const ok = true;\n");
  writeFileSync(join(root, ".env"), "SECRET=not-part-of-hash\n");
  writeFileSync(join(root, "data", "state.json"), '{"private":true}\n');
  return root;
}

function run(script: string, args: string[]): string {
  return execFileSync(process.execPath, [resolve(process.cwd(), "scripts", script), ...args], {
    encoding: "utf8",
  });
}

afterEach(() => {
  while (created.length > 0) rmSync(created.pop()!, { recursive: true, force: true });
});

describe("build provenance", () => {
  it("generates and verifies deterministic source, lock and dist hashes", () => {
    const root = fixture();
    const args = ["--root", root, "--test-result", "fixture-pass", "--generated-at", "2026-07-15T00:00:00.000Z"];
    expect(run("generate-build-provenance.mjs", args)).toContain("PROVENANCE_GENERATED=YES");
    const manifestPath = join(root, "build", "provenance", "source-manifest.json");
    const first = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(run("verify-build-provenance.mjs", ["--root", root, "--manifest", manifestPath])).toContain("PROVENANCE_VERIFIED=YES");
    run("generate-build-provenance.mjs", args);
    const second = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(second.source_tree_hash).toBe(first.source_tree_hash);
    expect(second.dist_tree_hash).toBe(first.dist_tree_hash);
    expect(second.package_lock_hash).toBe(first.package_lock_hash);
  });

  it("excludes environment and mutable data files from source identity", () => {
    const root = fixture();
    run("generate-build-provenance.mjs", ["--root", root, "--test-result", "fixture-pass"]);
    const manifest = JSON.parse(readFileSync(join(root, "build", "provenance", "source-manifest.json"), "utf8"));
    const paths = manifest.source_files.map((entry: { path: string }) => entry.path);
    expect(paths).not.toContain(".env");
    expect(paths.some((path: string) => path.startsWith("data/"))).toBe(false);
    expect(paths.some((path: string) => path.startsWith("build/provenance/"))).toBe(false);
  });

  it("fails verification after source drift", () => {
    const root = fixture();
    run("generate-build-provenance.mjs", ["--root", root, "--test-result", "fixture-pass"]);
    writeFileSync(join(root, "src", "server.ts"), "export const changed = true;\n");
    expect(() => run("verify-build-provenance.mjs", ["--root", root])).toThrow();
  });

  it("fails closed when compiled server output is absent", () => {
    const root = fixture();
    rmSync(join(root, "dist", "server.js"));
    expect(() => run("generate-build-provenance.mjs", ["--root", root, "--test-result", "fixture-pass"])).toThrow();
  });
});
