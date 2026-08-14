import type { StructuredAppFactsContext } from "../bridge/structuredAppFacts.js";

function normalize(value: string): string {
  return value.toLocaleLowerCase("tr-TR").normalize("NFKD").replace(/\p{M}/gu, "");
}

/** Derive the candidate vocabulary from validated facts; overrides can only narrow it. */
export function deriveApprovedApps(
  source: Pick<StructuredAppFactsContext, "source_status" | "app_facts">,
  override: string[] = [],
): string[] {
  if (source.source_status !== "loaded") return [];

  const ownerApproved = source.app_facts.filter((fact) => normalize(fact.status) === "owner_approved");
  if (ownerApproved.length === 0) return [];
  if (override.length === 0) return ownerApproved.map((fact) => fact.app);

  const restricted = new Set(override.map(normalize));
  return ownerApproved
    .filter((fact) => restricted.has(normalize(fact.app)))
    .map((fact) => fact.app);
}
