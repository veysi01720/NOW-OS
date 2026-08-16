import { resolve } from "node:path";
import { loadStructuredAppFacts, type StructuredAppFactsContext } from "./structuredAppFacts.js";
import { deriveApprovedApps } from "../config/approvedApps.js";
import { inspectRuntimeKnowledgeState } from "./runtimeKnowledgeState.js";

export interface KnowledgeStartupValidation {
  valid: boolean;
  structured_status: StructuredAppFactsContext["source_status"];
  manifest_status: "valid" | "missing" | "invalid";
  approved_app_count: number;
  routing_targets_valid: boolean;
  age_policy_valid: boolean;
  payment_policy_valid: boolean;
  runtime_source_present: boolean;
  runtime_source_readable: boolean;
  runtime_backup_present: boolean;
  runtime_backup_age_seconds: number | null;
  runtime_manifest_hash_valid: boolean;
  stage_policy_presence: Record<"intake" | "app_selection" | "installation", boolean>;
  stage_policy_warning_codes: string[];
  error_codes: string[];
  fallback_policy_warning_codes: string[];
}

function normalized(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function hasAgeInvariant(facts: StructuredAppFactsContext): boolean {
  const text = normalized(facts.policy_sections?.eligibility_rejection ?? "");
  return /18/.test(text) && /30/.test(text) && /40/.test(text);
}

function hasPaymentInvariant(facts: StructuredAppFactsContext): boolean {
  const text = normalized(`${facts.general_work_model?.payment_policy ?? ""} ${facts.policy_sections?.privacy_payment_support ?? ""}`);
  return /1\s*-\s*3/.test(text) && text.includes("iban") && text.includes("iptal edilemez");
}

function routingTargetsAreApproved(facts: StructuredAppFactsContext, approvedApps: string[]): boolean {
  const routing = normalized(facts.policy_sections?.routing_matrix ?? "");
  return approvedApps.every((app) => {
    const fact = facts.app_facts.find((candidate) => candidate.app === app);
    const names = [app, ...(fact?.aliases ?? [])].map(normalized);
    return names.some((name) => routing.includes(name));
  });
}

function fallbackPolicyWarnings(facts: StructuredAppFactsContext): string[] {
  const warnings: string[] = [];
  const profile = normalized(facts.policy_sections?.profile_bio_photo_rules ?? "");
  const payment = normalized(`${facts.general_work_model?.payment_policy ?? ""} ${facts.policy_sections?.privacy_payment_support ?? ""}`);

  // These warnings compare only policy claims with the hardcoded safety
  // boundaries. They never make startup fail; the published source remains
  // authoritative for candidate-facing content.
  if (/(kamera|goruntulu).*(zorunlu|sart|gerek)/.test(profile)) {
    warnings.push("FALLBACK_CAMERA_POLICY_CONFLICT");
  }
  if (/(garanti.*(var|verilir|edilir)|kesin.*kazanc|sabit (maas|ucret))/.test(payment)) {
    warnings.push("FALLBACK_GUARANTEE_POLICY_CONFLICT");
  }
  return warnings;
}

function stagePolicyPresence(facts: StructuredAppFactsContext): Record<"intake" | "app_selection" | "installation", boolean> {
  const sections = facts.policy_sections;
  const has = (keys: string[]) => Boolean(sections && keys.every((key) => typeof sections[key as keyof typeof sections] === "string" && sections[key as keyof typeof sections].trim() !== ""));
  return {
    intake: has(["eligibility_rejection", "profile_bio_photo_rules", "memory_rules"]),
    app_selection: has(["routing_matrix", "application_independence", "profile_bio_photo_rules", "memory_rules"]),
    installation: has(["installation_permission", "application_independence", "profile_bio_photo_rules", "memory_rules"]),
  };
}

export function validateKnowledgeAtStartup(knowledgeBankDir?: string): KnowledgeStartupValidation {
  const dir = knowledgeBankDir ?? process.env.KNOWLEDGE_BANK_DIR ?? resolve(process.cwd(), "data", "knowledge_bank");
  const runtime = inspectRuntimeKnowledgeState(dir);
  const facts = loadStructuredAppFacts(dir);
  const manifestStatus = runtime.manifest_status;
  const errors = [...facts.errors.map(() => "STRUCTURED_FACTS_SCHEMA_INVALID")];
  if (runtime.manifest_status === "missing") errors.push("STRUCTURED_MANIFEST_MISSING");
  if (runtime.manifest_status === "invalid") errors.push("STRUCTURED_FACTS_HASH_MISMATCH");
  errors.push(...runtime.errors.filter((code) =>
    code !== "RUNTIME_STRUCTURED_MANIFEST_MISSING" &&
    code !== "RUNTIME_STRUCTURED_MANIFEST_INVALID" &&
    code !== "RUNTIME_STRUCTURED_FACTS_INVALID"
  ));

  const approvedApps = deriveApprovedApps(facts, []);
  const routingValid = facts.source_status === "loaded" && approvedApps.length > 0 && routingTargetsAreApproved(facts, approvedApps);
  const ageValid = facts.source_status === "loaded" && hasAgeInvariant(facts);
  const paymentValid = facts.source_status === "loaded" && hasPaymentInvariant(facts);
  const fallbackWarnings = fallbackPolicyWarnings(facts);
  const stagePresence = stagePolicyPresence(facts);
  const stageWarnings = Object.entries(stagePresence)
    .filter(([, present]) => !present)
    .map(([stage]) => `STAGE_POLICY_SECTIONS_MISSING_${stage.toUpperCase()}`);
  if (!routingValid) errors.push("ROUTING_TARGET_NOT_APPROVED");
  if (!ageValid) errors.push("AGE_POLICY_INVARIANT_MISMATCH");
  if (!paymentValid) errors.push("PAYMENT_POLICY_INVARIANT_MISMATCH");

  return {
    valid: facts.source_status === "loaded" && manifestStatus === "valid" && errors.length === 0,
    structured_status: facts.source_status,
    manifest_status: manifestStatus,
    approved_app_count: approvedApps.length,
    routing_targets_valid: routingValid,
    age_policy_valid: ageValid,
    payment_policy_valid: paymentValid,
    runtime_source_present: runtime.runtime_source_present,
    runtime_source_readable: runtime.runtime_source_readable,
    runtime_backup_present: runtime.latest_backup_present,
    runtime_backup_age_seconds: runtime.latest_backup_age_seconds,
    runtime_manifest_hash_valid: runtime.manifest_hash_valid,
    stage_policy_presence: stagePresence,
    stage_policy_warning_codes: stageWarnings,
    error_codes: [...new Set(errors)],
    fallback_policy_warning_codes: fallbackWarnings,
  };
}
