import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

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
  errors: string[];
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
      errors: ["app_facts_structured.json missing"],
    };
  }

  const content = readFileSync(path, "utf8");
  try {
    const parsed = JSON.parse(content) as unknown;
    const record = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    const rawFacts = Array.isArray(record.app_facts) ? record.app_facts : [];
    const appFacts = rawFacts.map(toFact).filter((fact): fact is StructuredAppFact => fact !== null);
    const errors: string[] = [];
    if (appFacts.length !== rawFacts.length) errors.push("invalid app fact records found");
    if (appFacts.length === 0) errors.push("app_facts array empty");
    return {
      source_file: "app_facts_structured.json",
      source_status: errors.length === 0 ? "loaded" : "invalid",
      source_hash: sha256(content),
      app_facts: appFacts,
      errors,
    };
  } catch {
    return {
      source_file: "app_facts_structured.json",
      source_status: "invalid",
      source_hash: sha256(content),
      app_facts: [],
      errors: ["app_facts_structured.json parse failed"],
    };
  }
}

