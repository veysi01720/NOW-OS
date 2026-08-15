import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { loadStructuredAppFacts, type StructuredAppFactsContext } from "./structuredAppFacts.js";

export interface RuntimeKnowledgeState {
  runtime_source_present: boolean;
  runtime_source_readable: boolean;
  runtime_source_bytes: number;
  latest_backup_present: boolean;
  latest_backup_age_seconds: number | null;
  latest_backup_name: string | null;
  structured_status: StructuredAppFactsContext["source_status"];
  manifest_status: "valid" | "missing" | "invalid";
  manifest_hash_valid: boolean;
  runtime_source_hash: string | null;
  errors: string[];
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function backupNames(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.startsWith("app_facts.md.backup-") && !name.endsWith(".tmp"))
    .filter((name) => {
      try {
        return statSync(resolve(dir, name)).isFile();
      } catch {
        return false;
      }
    });
}

export function inspectRuntimeKnowledgeState(knowledgeBankDir?: string, nowMs = Date.now()): RuntimeKnowledgeState {
  const dir = resolve(knowledgeBankDir ?? process.env.KNOWLEDGE_BANK_DIR ?? resolve(process.cwd(), "data", "knowledge_bank"));
  const sourcePath = resolve(dir, "app_facts.md");
  const structured = loadStructuredAppFacts(dir);
  const errors: string[] = [];
  let runtimeSourceReadable = false;
  let runtimeSourceBytes = 0;
  let runtimeSourceHash: string | null = null;

  if (!existsSync(sourcePath)) {
    errors.push("RUNTIME_APP_FACTS_MISSING");
  } else {
    try {
      const source = readFileSync(sourcePath, "utf8");
      runtimeSourceReadable = true;
      runtimeSourceBytes = Buffer.byteLength(source, "utf8");
      runtimeSourceHash = sha256(source);
      if (runtimeSourceBytes === 0) errors.push("RUNTIME_APP_FACTS_EMPTY");
    } catch {
      errors.push("RUNTIME_APP_FACTS_UNREADABLE");
    }
  }

  const backups = backupNames(dir)
    .map((name) => ({ name, mtimeMs: statSync(resolve(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  const latestBackup = backups[0];
  const latestBackupAgeSeconds = latestBackup ? Math.max(0, Math.floor((nowMs - latestBackup.mtimeMs) / 1000)) : null;
  if (!latestBackup) errors.push("RUNTIME_APP_FACTS_BACKUP_MISSING");

  const manifestPath = resolve(dir, "structured_knowledge_manifest.json");
  let manifestStatus: RuntimeKnowledgeState["manifest_status"] = "missing";
  let manifestHashValid = false;
  if (existsSync(manifestPath) && structured.source_hash !== null) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
      manifestStatus = manifest.structured_hash === structured.source_hash ? "valid" : "invalid";
      manifestHashValid = manifestStatus === "valid";
    } catch {
      manifestStatus = "invalid";
    }
  }
  if (manifestStatus !== "valid") errors.push(`RUNTIME_STRUCTURED_MANIFEST_${manifestStatus.toUpperCase()}`);
  if (structured.source_status !== "loaded") errors.push("RUNTIME_STRUCTURED_FACTS_INVALID");

  return {
    runtime_source_present: existsSync(sourcePath),
    runtime_source_readable: runtimeSourceReadable,
    runtime_source_bytes: runtimeSourceBytes,
    latest_backup_present: Boolean(latestBackup),
    latest_backup_age_seconds: latestBackupAgeSeconds,
    latest_backup_name: latestBackup?.name ?? null,
    structured_status: structured.source_status,
    manifest_status: manifestStatus,
    manifest_hash_valid: manifestHashValid,
    runtime_source_hash: runtimeSourceHash,
    errors,
  };
}
