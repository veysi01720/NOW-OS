import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

describe("Workspace Lock (Preflight)", () => {
  const preflightScript = path.resolve(__dirname, "../workspace_preflight.ts");
  const tempDir = path.resolve(__dirname, "../../temp_workspace");
  const identityFile = path.join(tempDir, "workspace.identity.json");

  beforeEach(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }
  });

  afterEach(() => {
    if (fs.existsSync(identityFile)) {
      fs.unlinkSync(identityFile);
    }
    if (fs.existsSync(tempDir)) {
      fs.rmdirSync(tempDir);
    }
  });

  const runPreflight = () => {
    try {
      const output = execSync(`npx tsx ${preflightScript}`, {
        cwd: tempDir,
        encoding: "utf8",
        stdio: "pipe",
      });
      return { success: true, output };
    } catch (error: any) {
      return { success: false, output: error.stderr || error.stdout };
    }
  };

  it("1. Canonical production workspace -> PASS", () => {
    fs.writeFileSync(
      identityFile,
      JSON.stringify({
        workspace_role: "CANONICAL_PRODUCTION_SOURCE",
        production_target: "VPS now_os_backend",
        compose_project: "deploy_package",
        service_name: "now_os_backend",
      })
    );

    const result = runPreflight();
    expect(result.success).toBe(true);
    expect(result.output).toContain("WORKSPACE_PREFLIGHT=PASS");
    expect(result.output).toContain("RUNTIME_LOCK_STATUS=PRESERVED");
  });

  it("2. Eski local bridge (DEPRECATED_LOCAL_ONLY) -> production task DENY", () => {
    fs.writeFileSync(
      identityFile,
      JSON.stringify({
        workspace_role: "DEPRECATED_LOCAL_ONLY",
      })
    );

    const result = runPreflight();
    expect(result.success).toBe(false);
    expect(result.output).toContain("WORKSPACE_PREFLIGHT=DENIED");
    expect(result.output).toContain("REASON: DEPRECATED_WORKSPACE");
  });

  it("3. Missing identity (assistant-api or unknown) -> DENY", () => {
    const result = runPreflight();
    expect(result.success).toBe(false);
    expect(result.output).toContain("WORKSPACE_PREFLIGHT=DENIED");
    expect(result.output).toContain("REASON: NON_CANONICAL_WORKSPACE");
  });

  it("4. Yanlış Compose project -> DENY", () => {
    fs.writeFileSync(
      identityFile,
      JSON.stringify({
        workspace_role: "CANONICAL_PRODUCTION_SOURCE",
        production_target: "VPS now_os_backend",
        compose_project: "wrong_project",
        service_name: "now_os_backend",
      })
    );

    const result = runPreflight();
    expect(result.success).toBe(false);
    expect(result.output).toContain("REASON: COMPOSE_PROJECT_MISMATCH");
  });

  it("5. Yanlış target service -> DENY", () => {
    fs.writeFileSync(
      identityFile,
      JSON.stringify({
        workspace_role: "CANONICAL_PRODUCTION_SOURCE",
        production_target: "VPS now_os_backend",
        compose_project: "deploy_package",
        service_name: "wrong_service",
      })
    );

    const result = runPreflight();
    expect(result.success).toBe(false);
    expect(result.output).toContain("REASON: SERVICE_TARGET_MISMATCH");
  });

  it("6. Yanlış runtime target -> DENY", () => {
    fs.writeFileSync(
      identityFile,
      JSON.stringify({
        workspace_role: "CANONICAL_PRODUCTION_SOURCE",
        production_target: "Wrong target",
        compose_project: "deploy_package",
        service_name: "now_os_backend",
      })
    );

    const result = runPreflight();
    expect(result.success).toBe(false);
    expect(result.output).toContain("REASON: PRODUCTION_TARGET_MISMATCH");
  });
});
