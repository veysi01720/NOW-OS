import { resolve } from "node:path";

export function productionKnowledgeBankDir(): string {
  return resolve(process.cwd(), "data", "knowledge_bank");
}

export function assertNonProductionKnowledgePathForTest(path: string): void {
  if (process.env.NODE_ENV !== "test") return;

  const resolved = resolve(path);
  if (resolved === productionKnowledgeBankDir()) {
    throw new Error("Test attempted to use production data/knowledge_bank path. Use a temp KNOWLEDGE_BANK_DIR.");
  }
}
