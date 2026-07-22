import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { handleOwnerCommand } from "../bridge/ownerCommands.js";
import type { NormalizedIncomingMessage } from "../bridge/normalizeEvolutionMessage.js";
import { PersistentIngestionStore } from "../storage/ingestionStore.js";
import { createTestEnv } from "./testDoubles.js";

function ownerMessage(text: string): NormalizedIncomingMessage {
  return {
    correlation_id: "corr_owner_learning_action",
    sender_id: "905111111111",
    phone_number: "905111111111",
    remote_jid: "905111111111@s.whatsapp.net",
    message_id: "owner_learning_action_msg",
    message_type: "conversation",
    text,
    chat_type: "private",
    is_from_me: false,
    is_group: false,
    received_at: "2026-07-22T00:00:00.000Z"
  };
}

describe("owner learning queue deterministic actions", () => {
  let rootDir: string;
  let storeDir: string;
  let knowledgeBankDir: string;
  let previousKnowledgeBankDir: string | undefined;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), "now-os-owner-learning-actions-"));
    storeDir = resolve(rootDir, "store");
    knowledgeBankDir = resolve(rootDir, "knowledge_bank");
    previousKnowledgeBankDir = process.env.KNOWLEDGE_BANK_DIR;
    process.env.KNOWLEDGE_BANK_DIR = knowledgeBankDir;
  });

  afterEach(() => {
    if (previousKnowledgeBankDir === undefined) {
      delete process.env.KNOWLEDGE_BANK_DIR;
    } else {
      process.env.KNOWLEDGE_BANK_DIR = previousKnowledgeBankDir;
    }
    rmSync(rootDir, { recursive: true, force: true });
  });

  it("approves one pending LRN and syncs it through approved_learning outputs", () => {
    const store = new PersistentIngestionStore(storeDir);
    store.saveLearningSuggestion({
      suggestion_id: "sug_owner_approve",
      source_job_id: "live_owner_interaction",
      platform: "whatsapp",
      suggestion_class: "unknown",
      evidence_preview_sanitized: "App: NewApp, Invite: INV-1",
      proposed_knowledge_type: "approved_app_update",
      proposed_text: "Uygulama Adi: NewApp\nDavet Kodu: INV-1",
      confidence: 0.99,
      status: "pending_owner_review",
      created_at: "2026-07-22T00:00:00.000Z",
      source_type: "live_owner_interaction",
      source_message_safe_ref: "owner_msg_1",
      suggested_category: "owner_platform_update"
    });

    const result = handleOwnerCommand(
      ownerMessage("LRN-1 onayla"),
      "owner",
      createTestEnv(),
      undefined,
      store
    );

    expect(result.is_command).toBe(true);
    expect(result.reply_text).toContain("LRN-1 onaylandi ve bilgi bankasina aktarildi");
    expect(store.getLearningSuggestion("sug_owner_approve")?.status).toBe("approved");
    expect(store.listLearningSuggestions().filter((item) => item.status === "pending_owner_review")).toHaveLength(0);

    const approvedJsonPath = resolve(knowledgeBankDir, "approved_learning.json");
    const approvedMdPath = resolve(knowledgeBankDir, "approved_learning.md");
    expect(existsSync(approvedJsonPath)).toBe(true);
    expect(existsSync(approvedMdPath)).toBe(true);

    const approvedJson = JSON.parse(readFileSync(approvedJsonPath, "utf-8"));
    expect(approvedJson).toHaveLength(1);
    expect(approvedJson[0].source_suggestion_ref).toBe("LRN-1");
    expect(approvedJson[0].sanitized_content).toContain("Uygulama Adi: NewApp");
  });

  it("rejects one pending LRN without writing active knowledge", () => {
    const store = new PersistentIngestionStore(storeDir);
    store.saveLearningSuggestion({
      suggestion_id: "sug_owner_reject",
      source_job_id: "live_owner_interaction",
      platform: "whatsapp",
      suggestion_class: "unknown",
      evidence_preview_sanitized: "App: BadApp, Invite: BAD",
      proposed_knowledge_type: "approved_app_update",
      proposed_text: "Uygulama Adi: BadApp",
      confidence: 0.99,
      status: "pending_owner_review",
      created_at: "2026-07-22T00:00:00.000Z",
      source_type: "live_owner_interaction",
      source_message_safe_ref: "owner_msg_2",
      suggested_category: "owner_platform_update"
    });

    const result = handleOwnerCommand(
      ownerMessage("LRN-1 reddet"),
      "owner",
      createTestEnv(),
      undefined,
      store
    );

    expect(result.is_command).toBe(true);
    expect(result.reply_text).toBe("LRN-1 reddedildi. Pending listeden cikarildi. Aktif bilgi/config degismedi.");
    expect(store.getLearningSuggestion("sug_owner_reject")?.status).toBe("rejected");
    expect(store.listLearningSuggestions().filter((item) => item.status === "pending_owner_review")).toHaveLength(0);
    expect(existsSync(resolve(knowledgeBankDir, "approved_learning.json"))).toBe(false);
  });
});
