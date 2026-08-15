import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadStructuredAppFacts, type StructuredAppFactsContext } from "./structuredAppFacts.js";
import { deriveApprovedApps } from "../config/approvedApps.js";

export interface KnowledgeStartupValidation {
  valid: boolean;
  structured_status: StructuredAppFactsContext["source_status"];
  manifest_status: "valid" | "missing" | "invalid";
  approved_app_count: number;
  routing_targets_valid: boolean;
  age_policy_valid: boolean;
  payment_policy_valid: boolean;
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

export function validateKnowledgeAtStartup(knowledgeBankDir?: string): KnowledgeStartupValidation {
  const facts = loadStructuredAppFacts(knowledgeBankDir);
  const dir = knowledgeBankDir ?? process.env.KNOWLEDGE_BANK_DIR ?? resolve(process.cwd(), "data", "knowledge_bank");
  const manifestPath = resolve(dir, "structured_knowledge_manifest.json");
  let manifestStatus: KnowledgeStartupValidation["manifest_status"] = "missing";
  const errors = [...facts.errors.map(() => "STRUCTURED_FACTS_SCHEMA_INVALID")];

  if (existsSync(manifestPath) && facts.source_hash !== null) {
    try {
      const manifestRaw = readFileSync(manifestPath, "utf8");
      const manifest = JSON.parse(manifestRaw) as Record<string, unknown>;
      manifestStatus = manifest.structured_hash === facts.source_hash ? "valid" : "invalid";
      if (manifestStatus !== "valid") errors.push("STRUCTURED_FACTS_HASH_MISMATCH");
    } catch {
      manifestStatus = "invalid";
      errors.push("STRUCTURED_MANIFEST_INVALID");
    }
  } else {
    errors.push("STRUCTURED_MANIFEST_MISSING");
  }

  const approvedApps = deriveApprovedApps(facts, []);
  const routingValid = facts.source_status === "loaded" && approvedApps.length > 0 && routingTargetsAreApproved(facts, approvedApps);
  const ageValid = facts.source_status === "loaded" && hasAgeInvariant(facts);
  const paymentValid = facts.source_status === "loaded" && hasPaymentInvariant(facts);
  const fallbackWarnings = fallbackPolicyWarnings(facts);
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
    error_codes: [...new Set(errors)],
    fallback_policy_warning_codes: fallbackWarnings,
  };
}
