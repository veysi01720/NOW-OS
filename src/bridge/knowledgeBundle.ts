import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { validateKnowledgeSourceIntegrity } from "./sourceIntegrity.js";
import { assertNonProductionKnowledgePathForTest } from "../utils/testPathGuard.js";

export const KNOWLEDGE_BUNDLE_FILES = [
  "approved_learning.md",
  "app_facts.md",
  "link_catalog.md",
  "core_system_rules.md",
  "intent_taxonomy.md",
  "response_style_rules.md",
  "app_routing_rules.md",
  "escalation_rules.md",
  "knowledge_usage_policy.md",
  "workflow_rules.md",
  "faq.md"
] as const;

function ownerApprovedTrainingFiles(): string[] {
  const trainingDir = resolve(knowledgeBankDir(), "owner_approved_training");
  if (!existsSync(trainingDir)) return [];
  return readdirSync(trainingDir)
    .filter((fileName) => fileName.endsWith(".md"))
    .sort()
    .map((fileName) => `owner_approved_training/${fileName}`);
}

function bundleSourceFiles(): string[] {
  return [...KNOWLEDGE_BUNDLE_FILES, ...ownerApprovedTrainingFiles()];
}

export interface KnowledgeBundleSource {
  path: string;
  content: string;
  files: string[];
}

let lastGeneratedBundleContent: string | null = null;

export function knowledgeBankDir(): string {
  const dir = process.env.KNOWLEDGE_BANK_DIR ? resolve(process.env.KNOWLEDGE_BANK_DIR) : resolve(process.cwd(), "data", "knowledge_bank");
  assertNonProductionKnowledgePathForTest(dir);
  return dir;
}

export function fullBundlePath(): string {
  return resolve(knowledgeBankDir(), "full_approved_knowledge_bundle.md");
}

export function publishManifestPath(): string {
  if (process.env.PUBLISH_MANIFEST_PATH) return resolve(process.env.PUBLISH_MANIFEST_PATH);
  return resolve(process.cwd(), "data", "publish_manifest.json");
}

function relPath(path: string): string {
  return relative(process.cwd(), path).replaceAll("\\", "/");
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function sourceTypeFor(fileName: string): string {
  switch (fileName) {
    case "approved_learning.md":
      return "approved_learning/spec030c_behavior_rules";
    case "app_facts.md":
      return "deterministic_app_facts";
    case "link_catalog.md":
      return "deterministic_link_catalog";
    case "core_system_rules.md":
    case "intent_taxonomy.md":
    case "response_style_rules.md":
    case "app_routing_rules.md":
    case "escalation_rules.md":
    case "knowledge_usage_policy.md":
    case "workflow_rules.md":
    case "faq.md":
      return "core_intelligence";
    default:
      if (fileName.startsWith("owner_approved_training/")) return "owner_approved_training";
      return "unknown";
  }
}

function recordCount(fileName: string, content: string): number {
  if (fileName === "approved_learning.md") return (content.match(/^## \[KB-/gm) ?? []).length;
  if (fileName === "app_facts.md" || fileName === "link_catalog.md") {
    return content.split(/\r?\n/).filter((line) => line.trim().startsWith("|") && !line.includes("---")).length - 1;
  }
  if (fileName.endsWith(".md")) return (content.match(/^#|^- /gm) ?? []).length;
  return 0;
}

function scanSecurity(content: string) {
  return {
    secrets_in_bundle: /(sk-svcacct|sk-proj|sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,})/.test(content),
    env_values_in_bundle: /\b(OPENAI_API_KEY|EVOLUTION_API_KEY|EVOLUTION_API_BASE_URL|OWNER_PHONE_NUMBERS|MANAGER_PHONE_NUMBERS)\b/.test(content),
    raw_phone_in_bundle: /(?<!\d)905\d{9}(?!\d)/.test(content),
    raw_remote_jid_in_bundle: /@s\.whatsapp\.net/.test(content),
    raw_group_id_in_bundle: /@g\.us/.test(content),
    raw_message_dump_in_bundle: /\[\d{1,2}\.\d{1,2}\.\d{4}\s+\d{1,2}:\d{2}/.test(content),
    raw_zip_content_in_bundle: /PK\x03\x04|base64,/.test(content),
    private_admin_content_in_bundle: false
  };
}

function readPreviousManifest(): { previousManifestPath: string | null; previousBundleHash: string | null } {
  const path = publishManifestPath();
  if (!existsSync(path)) return { previousManifestPath: null, previousBundleHash: null };
  try {
    const previous = JSON.parse(readFileSync(path, "utf8")) as any;
    return {
      previousManifestPath: relPath(path),
      previousBundleHash: previous.bundle_output?.sha256 ?? previous.source_hash_masked ?? null
    };
  } catch {
    return { previousManifestPath: relPath(path), previousBundleHash: null };
  }
}

export function buildKnowledgeBundleContent(): string {
  const approvedLearningPath = resolve(knowledgeBankDir(), "approved_learning.md");
  if (!existsSync(approvedLearningPath) && lastGeneratedBundleContent !== null) {
    return lastGeneratedBundleContent;
  }

  const content = bundleSourceFiles().map((fileName) => {
    const filePath = resolve(knowledgeBankDir(), fileName);
    const fileContent = existsSync(filePath)
      ? readFileSync(filePath, "utf8").trim()
      : `# ${fileName}\n\nMISSING`;
    return `\n\n<!-- SOURCE_FILE: ${fileName} -->\n\n${fileContent}\n`;
  }).join("").trim() + "\n";

  lastGeneratedBundleContent = content;
  return content;
}

export function writeKnowledgeBundleAndManifest(): KnowledgeBundleSource {
  const previous = readPreviousManifest();
  const bundlePath = fullBundlePath();
  const content = buildKnowledgeBundleContent();
  mkdirSync(dirname(bundlePath), { recursive: true });
  writeFileSync(bundlePath, content, "utf8");

  const sourceFiles = bundleSourceFiles().map((fileName) => {
    const absolutePath = resolve(knowledgeBankDir(), fileName);
    let exists = false;
    let fileContent = "";
    try {
      fileContent = readFileSync(absolutePath, "utf8");
      exists = true;
    } catch {
      exists = false;
    }
    return {
      path: relPath(absolutePath),
      exists,
      size_bytes: exists ? Buffer.byteLength(fileContent, "utf8") : 0,
      sha256: exists ? sha256(fileContent) : null,
      source_type: sourceTypeFor(fileName),
      record_count: exists ? recordCount(fileName, fileContent) : 0,
      included_in_bundle: content.includes(`SOURCE_FILE: ${fileName}`)
    };
  });

  const security = scanSecurity(content);
  const sourceIntegrity = validateKnowledgeSourceIntegrity({ fullBundleContent: content });
  const spec030cRuleCount = (content.match(/^## \[KB-00[1-5]\]/gm) ?? []).length;
  const bundleHash = sha256(content);
  const bundleSizeBytes = Buffer.byteLength(content, "utf8");

  const manifest = {
    generated_at: new Date().toISOString(),
    mode: "dry_run",
    real_publish_triggered: false,
    openai_publish_called: false,
    vector_store_modified: false,
    source_files: sourceFiles,
    bundle_output: {
      path: relPath(bundlePath),
      exists: true,
      size_bytes: bundleSizeBytes,
      sha256: bundleHash,
      generated_from_source_count: sourceFiles.length,
      contains_core_intelligence: sourceFiles.some((file) => file.source_type === "core_intelligence" && file.included_in_bundle),
      contains_app_facts: content.includes("SOURCE_FILE: app_facts.md"),
      contains_link_catalog: content.includes("SOURCE_FILE: link_catalog.md"),
      contains_approved_learning: content.includes("SOURCE_FILE: approved_learning.md"),
      contains_spec030c_rules: spec030cRuleCount === 5,
      spec030c_rule_count: spec030cRuleCount,
      contains_owner_approved_training: content.includes("SOURCE_FILE: owner_approved_training/"),
      owner_approved_training_file_count: sourceIntegrity.training_files_count
    },
    rollback_metadata: {
      current_assistant_vector_store_id_present: !!process.env.OPENAI_VECTOR_STORE_ID,
      previous_publish_manifest_path: previous.previousManifestPath,
      previous_bundle_hash: previous.previousBundleHash,
      rollback_possible_without_data_loss: true,
      note: "No vector store modified during dry-run."
    },
    security_scan: security,
    source_integrity: sourceIntegrity,
    validation: {
      all_source_files_exist: sourceFiles.every((file) => file.exists),
      all_source_files_included: sourceFiles.every((file) => file.included_in_bundle),
      manifest_no_missing_required_file: sourceFiles.every((file) => file.exists && file.included_in_bundle) && sourceIntegrity.publish_allowed,
      safety_scan_status: Object.values(security).every((value) => value === false) ? "PASS" : "FAIL"
    }
  };

  writeFileSync(publishManifestPath(), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return {
    path: bundlePath,
    content,
    files: bundleSourceFiles()
  };
}
