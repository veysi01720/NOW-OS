import { describe, expect, it } from "vitest";
import { handleOwnerCommand } from "../bridge/ownerCommands.js";
import { PersistentIngestionStore } from "../storage/ingestionStore.js";
import type { NormalizedIncomingMessage } from "../bridge/normalizeEvolutionMessage.js";
import { createTestEnv } from "./testDoubles.js";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function ownerMessage(text: string): NormalizedIncomingMessage {
  return {
    correlation_id: "corr_knowledge_sync",
    sender_id: "owner",
    phone_number: "owner",
    remote_jid: "owner@s.whatsapp.net",
    message_id: "knowledge_sync_message",
    message_type: "conversation",
    text,
    chat_type: "private",
    is_from_me: false,
    is_group: false,
    received_at: new Date().toISOString(),
  };
}

describe("deterministic owner knowledge sync routing", () => {
  it.each([
    "#komut onaylıları bilgi bankasına aktar",
    "onaylıları bilgi bankasına aktar",
  ])("executes the canonical command or alias without entering the model path: %s", (text) => {
    const root = mkdtempSync(join(tmpdir(), "now-os-owner-sync-command-"));
    const previousKnowledgeBankDir = process.env.KNOWLEDGE_BANK_DIR;
    try {
      const store = new PersistentIngestionStore(resolve(root, "store"));
      process.env.KNOWLEDGE_BANK_DIR = resolve(root, "knowledge_bank");
      store.saveLearningSuggestion({
        suggestion_id: "sync_suggestion",
        source_job_id: "sync_job",
        platform: "whatsapp",
        suggestion_class: "unknown",
        evidence_preview_sanitized: "approved safe fact",
        proposed_knowledge_type: "app_fact_candidate",
        proposed_text: "Safe approved app fact",
        confidence: 0.95,
        status: "approved",
        created_at: new Date().toISOString()
      });
      const result = handleOwnerCommand(ownerMessage(text), "owner", createTestEnv(), undefined, store);
      expect(result.is_command).toBe(true);
      expect(result.assistant_run_skipped).toBe(true);
      expect(result.skip_reason).toBe("owner_knowledge_sync_command");
      expect(result.reply_text).toContain("Bilgi senkronizasyonu");
      expect(existsSync(resolve(root, "knowledge_bank", "approved_learning.json"))).toBe(true);
      expect(store.getLearningSuggestion("sync_suggestion")?.status).toBe("approved");
    } finally {
      if (previousKnowledgeBankDir === undefined) delete process.env.KNOWLEDGE_BANK_DIR;
      else process.env.KNOWLEDGE_BANK_DIR = previousKnowledgeBankDir;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an unrecognized knowledge-sync intent deterministically", () => {
    const root = mkdtempSync(join(tmpdir(), "now-os-owner-sync-unknown-"));
    try {
      const store = new PersistentIngestionStore(resolve(root, "store"));
      const result = handleOwnerCommand(ownerMessage("bilgi bankasını hemen senkronize et"), "owner", createTestEnv(), undefined, store);
      expect(result.is_command).toBe(true);
      expect(result.assistant_run_skipped).toBe(true);
      expect(result.skip_reason).toBe("owner_knowledge_sync_command_not_understood");
      expect(result.reply_text).toContain("Komut formatı tanınmadı");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
