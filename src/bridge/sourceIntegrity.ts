import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { assertNonProductionKnowledgePathForTest } from "../utils/testPathGuard.js";

export const REQUIRED_KNOWLEDGE_SOURCE_FILES = [
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

export interface KnowledgeSourceIntegrityResult {
  publish_allowed: boolean;
  missing_required_files: string[];
  files_with_missing_placeholder: string[];
  suspiciously_tiny_files: string[];
  app_facts_official_values_present: boolean;
  link_catalog_policy_present: boolean;
  full_bundle_contains_placeholder: boolean;
  source_count_below_expected: boolean;
  owner_approved_training_included: boolean;
  training_files_count: number;
  errors: string[];
}

const MIN_SOURCE_FILE_BYTES = 80;
const EXPECTED_MIN_SOURCE_COUNT = REQUIRED_KNOWLEDGE_SOURCE_FILES.length + 5;
const REQUIRED_APP_FACT_PATTERNS = [
  /Layla[\s\S]*NIVI/i,
  /TanChat[\s\S]*TanStar/i,
  /Amar[\s\S]*xvrgZkf6/i,
  /Amar[\s\S]*10621/i,
  /Linky[\s\S]*M9W5B8/i,
  /Soyo[\s\S]*3997/i
];
const REQUIRED_LINK_POLICY_PATTERNS = [
  /fake|tahmini/i,
  /generic store/i,
  /link uydurmak yasak/i
];

function hasMissingPlaceholder(content: string): boolean {
  return /^MISSING$/m.test(content) || /# .+\.md\s+MISSING/m.test(content);
}

export function validateKnowledgeSourceIntegrity(options?: {
  knowledgeBankDir?: string;
  fullBundleContent?: string;
}): KnowledgeSourceIntegrityResult {
  const knowledgeBankDir = options?.knowledgeBankDir ?? process.env.KNOWLEDGE_BANK_DIR ?? resolve(process.cwd(), "data", "knowledge_bank");
  assertNonProductionKnowledgePathForTest(knowledgeBankDir);
  const missing_required_files: string[] = [];
  const files_with_missing_placeholder: string[] = [];
  const suspiciously_tiny_files: string[] = [];
  const errors: string[] = [];

  for (const fileName of REQUIRED_KNOWLEDGE_SOURCE_FILES) {
    const filePath = resolve(knowledgeBankDir, fileName);
    if (!existsSync(filePath)) {
      missing_required_files.push(fileName);
      continue;
    }
    const content = readFileSync(filePath, "utf8");
    if (Buffer.byteLength(content, "utf8") < MIN_SOURCE_FILE_BYTES) suspiciously_tiny_files.push(fileName);
    if (hasMissingPlaceholder(content)) files_with_missing_placeholder.push(fileName);
  }

  const appFactsPath = resolve(knowledgeBankDir, "app_facts.md");
  const appFactsContent = existsSync(appFactsPath) ? readFileSync(appFactsPath, "utf8") : "";
  const app_facts_official_values_present = REQUIRED_APP_FACT_PATTERNS.every((pattern) => pattern.test(appFactsContent));
  if (!app_facts_official_values_present) errors.push("app_facts missing one or more official app facts");

  const linkCatalogPath = resolve(knowledgeBankDir, "link_catalog.md");
  const linkCatalogContent = existsSync(linkCatalogPath) ? readFileSync(linkCatalogPath, "utf8") : "";
  const link_catalog_policy_present = REQUIRED_LINK_POLICY_PATTERNS.every((pattern) => pattern.test(linkCatalogContent));
  if (!link_catalog_policy_present) errors.push("link_catalog missing link policy guard");

  const trainingDir = resolve(knowledgeBankDir, "owner_approved_training");
  const training_files_count = existsSync(trainingDir)
    ? readdirSync(trainingDir).filter((fileName) => fileName.endsWith(".md")).length
    : 0;
  const owner_approved_training_included = training_files_count >= 5;
  if (!owner_approved_training_included) errors.push("owner_approved_training is not fully included");

  const sourceCount = REQUIRED_KNOWLEDGE_SOURCE_FILES.length + training_files_count;
  const source_count_below_expected = sourceCount < EXPECTED_MIN_SOURCE_COUNT;
  if (source_count_below_expected) errors.push("source count is below expected minimum");

  const full_bundle_contains_placeholder = options?.fullBundleContent ? hasMissingPlaceholder(options.fullBundleContent) : false;
  if (full_bundle_contains_placeholder) errors.push("full bundle contains MISSING placeholder");

  const publish_allowed =
    missing_required_files.length === 0 &&
    files_with_missing_placeholder.length === 0 &&
    suspiciously_tiny_files.length === 0 &&
    app_facts_official_values_present &&
    link_catalog_policy_present &&
    !full_bundle_contains_placeholder &&
    !source_count_below_expected &&
    owner_approved_training_included;

  return {
    publish_allowed,
    missing_required_files,
    files_with_missing_placeholder,
    suspiciously_tiny_files,
    app_facts_official_values_present,
    link_catalog_policy_present,
    full_bundle_contains_placeholder,
    source_count_below_expected,
    owner_approved_training_included,
    training_files_count,
    errors
  };
}
