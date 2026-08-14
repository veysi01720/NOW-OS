import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { StructuredPolicySections } from "../contracts/backendContextPayload.js";

export interface StructuredAppFact {
  app: string;
  android_name: string;
  ios_name: string;
  invite_code: string | null;
  agency_bind_code: string | null;
  agency_code: string | null;
  official_url: string | null;
  status: string;
  aliases: string[];
  capabilities: {
    text_only: boolean;
    video_required: boolean | null;
  };
}

export interface StructuredAppFactsContext {
  source_file: "app_facts_structured.json";
  source_status: "loaded" | "missing" | "invalid";
  source_hash: string | null;
  app_facts: StructuredAppFact[];
  general_work_model: StructuredGeneralWorkModel | null;
  policy_sections: StructuredPolicySections | null;
  errors: string[];
}

export interface StructuredGeneralWorkModel {
  app_independent: true;
  source_section: "Genel İş Modeli";
  summary: string;
  workflow: string;
  earnings_policy: string;
  payment_policy: string;
  setup_boundary: string;
}

function normalizeOptional(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAliases(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim());
}

function normalizeBoolean(value: unknown): boolean {
  return value === true;
}

function normalizeNullableBoolean(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  return null;
}

function toFact(value: unknown): StructuredAppFact | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const app = normalizeString(record.app);
  const androidName = normalizeString(record.android_name);
  const iosName = normalizeString(record.ios_name);
  const status = normalizeString(record.status);
  if (!app || !androidName || !iosName || !status) return null;
  const capabilities = record.capabilities && typeof record.capabilities === "object" && !Array.isArray(record.capabilities)
    ? record.capabilities as Record<string, unknown>
    : {};
  return {
    app,
    android_name: androidName,
    ios_name: iosName,
    invite_code: normalizeOptional(record.invite_code),
    agency_bind_code: normalizeOptional(record.agency_bind_code),
    agency_code: normalizeOptional(record.agency_code),
    official_url: normalizeOptional(record.official_url),
    status,
    aliases: normalizeAliases(record.aliases),
    capabilities: {
      text_only: normalizeBoolean(capabilities.text_only),
      video_required: normalizeNullableBoolean(capabilities.video_required),
    },
  };
}

function toGeneralWorkModel(value: unknown): StructuredGeneralWorkModel | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const fields = ["summary", "workflow", "earnings_policy", "payment_policy", "setup_boundary"];
  if (!fields.every((field) => typeof record[field] === "string" && String(record[field]).trim() !== "")) return null;
  return {
    app_independent: true,
    source_section: "Genel İş Modeli",
    summary: String(record.summary).trim(),
    workflow: String(record.workflow).trim(),
    earnings_policy: String(record.earnings_policy).trim(),
    payment_policy: String(record.payment_policy).trim(),
    setup_boundary: String(record.setup_boundary).trim(),
  };
}

const POLICY_SECTION_KEYS: Array<keyof StructuredPolicySections> = [
  "routing_matrix",
  "application_independence",
  "profile_bio_photo_rules",
  "memory_rules",
  "eligibility_rejection",
  "installation_permission",
  "privacy_payment_support",
  "followup_closure_group_rules",
];

function toPolicySections(value: unknown): { sections: StructuredPolicySections | null; errors: string[] } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { sections: null, errors: ["policy_sections missing or invalid"] };
  }
  const record = value as Record<string, unknown>;
  const missing = POLICY_SECTION_KEYS.filter((key) => typeof record[key] !== "string" || String(record[key]).trim() === "");
  if (missing.length > 0) {
    return { sections: null, errors: [`policy_sections missing: ${missing.join(",")}`] };
  }
  return {
    sections: Object.fromEntries(POLICY_SECTION_KEYS.map((key) => [key, String(record[key]).trim()])) as unknown as StructuredPolicySections,
    errors: [],
  };
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function appFactsStructuredPath(knowledgeBankDir?: string): string {
  const dir = knowledgeBankDir ?? process.env.KNOWLEDGE_BANK_DIR ?? resolve(process.cwd(), "data", "knowledge_bank");
  return resolve(dir, "app_facts_structured.json");
}

export function loadStructuredAppFacts(knowledgeBankDir?: string): StructuredAppFactsContext {
  const path = appFactsStructuredPath(knowledgeBankDir);
  if (!existsSync(path)) {
    return {
      source_file: "app_facts_structured.json",
      source_status: "missing",
      source_hash: null,
      app_facts: [],
      general_work_model: null,
      policy_sections: null,
      errors: ["app_facts_structured.json missing"],
    };
  }

  const content = readFileSync(path, "utf8");
  try {
    const parsed = JSON.parse(content) as unknown;
    const record = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    const rawFacts = Array.isArray(record.app_facts) ? record.app_facts : [];
    const appFacts = rawFacts.map(toFact).filter((fact): fact is StructuredAppFact => fact !== null);
    const generalWorkModel = toGeneralWorkModel(record.general_work_model);
    const policyResult = toPolicySections(record.policy_sections);
    const errors: string[] = [];
    if (appFacts.length !== rawFacts.length) errors.push("invalid app fact records found");
    if (appFacts.length === 0) errors.push("app_facts array empty");
    if (generalWorkModel === null) errors.push("general_work_model missing or invalid");
    errors.push(...policyResult.errors);
    return {
      source_file: "app_facts_structured.json",
      source_status: errors.length === 0 ? "loaded" : "invalid",
      source_hash: sha256(content),
      app_facts: appFacts,
      general_work_model: generalWorkModel,
      policy_sections: policyResult.sections,
      errors,
    };
  } catch {
    return {
      source_file: "app_facts_structured.json",
      source_status: "invalid",
      source_hash: sha256(content),
      app_facts: [],
      general_work_model: null,
      policy_sections: null,
      errors: ["app_facts_structured.json parse failed"],
    };
  }
}
