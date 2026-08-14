import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { handleOwnerCommand } from "../bridge/ownerCommands.js";
import { ZipIngestionStore } from "../bridge/zipIngestion/store.js";
import type { ZipIngestionJobRecord, ZipLearningCandidateRecord } from "../bridge/zipIngestion/types.js";
import type { NormalizedIncomingMessage } from "../bridge/normalizeEvolutionMessage.js";
import { writeValidKnowledgeBankFixture } from "./fixtures/knowledgeBankFixture.js";
import { createTestEnv } from "./testDoubles.js";
import { createHash } from "node:crypto";

function ownerMessage(text: string, chatType: "private" | "group" = "private"): NormalizedIncomingMessage {
  return {
    correlation_id: "corr_owner_knowledge_whatsapp",
    sender_id: "owner",
    phone_number: "905111111111",
    remote_jid: chatType === "private" ? "owner@s.whatsapp.net" : "group@g.us",
    message_id: `msg-${text}`,
    message_type: "conversation",
    text,
    chat_type: chatType,
    is_from_me: false,
    is_group: chatType === "group",
    received_at: new Date().toISOString(),
  };
}

function seedPending(store: ZipIngestionStore, status: ZipLearningCandidateRecord["status"] = "pending_owner_review"): void {
  const now = new Date().toISOString();
  const job: ZipIngestionJobRecord = {
    id: "owner_text_test",
    created_at: now,
    updated_at: now,
    sender_role: "owner",
    sender_masked: "905***",
    source_channel: "whatsapp",
    source_instance: "test",
    original_filename: "owner-text.txt",
    zip_sha256: "not-a-zip",
    zip_size_bytes: 1,
    status: "completed",
    status_reason: "pending_owner_review",
    total_entries: 1,
    accepted_entries: 1,
    rejected_entries: 0,
    extracted_text_records: 1,
    media_records: 0,
    duplicate_of_job_id: null,
    manifest_path: "manifest.json",
    approved_for_review: true,
  };
  store.saveJob(job);
  const text = "Erkek hesap kurali owner onayindan sonra aktif olur.";
  const textHash = createHash("sha256").update(text).digest("hex");
  store.saveLearningCandidate({
    id: "candidate_owner_text",
    source: "owner_direct_text",
    source_job_id: job.id,
    source_entry_id: "direct",
    candidate_type: "app_fact_candidate",
    extracted_text: text,
    status,
    confidence: 1,
    created_at: now,
    approved_by: status === "approved_for_bundle" ? "owner" : null,
    approved_at: status === "approved_for_bundle" ? now : null,
    section_id: "section_owner_rule",
    section_title: "Erkek hesap kurali",
    classification: "constraint",
    target_file: "app_facts.md",
    source_hash: textHash,
    section_hash: textHash,
  });
}

describe("owner knowledge WhatsApp commands", () => {
  it("lists pending sections with a short ref and approves only the selected section", () => {
    const root = mkdtempSync(join(tmpdir(), "owner-knowledge-wa-review-"));
    try {
      const store = new ZipIngestionStore(resolve(root, "zip-store.json"));
      seedPending(store);
      const deps = { zipIngestionStore: store };
      const list = handleOwnerCommand(ownerMessage("#bekleyenler"), "owner", createTestEnv(), undefined, undefined, undefined, deps);
      const shortRef = list.reply_text?.match(/BLG-[A-F0-9]{8}-01/)?.[0];
      expect(shortRef).toBeTruthy();
      expect(list.reply_text).toContain("Erkek hesap kurali");
      expect(list.reply_text).toContain("app_facts.md");

      const approve = handleOwnerCommand(ownerMessage(`#onayla ${shortRef}`), "owner", createTestEnv(), undefined, undefined, undefined, deps);
      expect(approve.execution_succeeded).toBe(true);
      expect(store.getLearningCandidate("candidate_owner_text")?.status).toBe("approved_for_bundle");
      expect(approve.reply_text).toContain("Aktif bilgi henuz degismedi");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects invalid refs and keeps group commands from changing review state", () => {
    const root = mkdtempSync(join(tmpdir(), "owner-knowledge-wa-reject-"));
    try {
      const store = new ZipIngestionStore(resolve(root, "zip-store.json"));
      seedPending(store);
      const deps = { zipIngestionStore: store };
      const invalid = handleOwnerCommand(ownerMessage("#onayla BLG-NOT-FOUND"), "owner", createTestEnv(), undefined, undefined, undefined, deps);
      expect(invalid.reply_text).toContain("bulunamadi");
      expect(store.getLearningCandidate("candidate_owner_text")?.status).toBe("pending_owner_review");
      const group = handleOwnerCommand(ownerMessage("#reddet BLG-TEST-01", "group"), "owner", createTestEnv(), undefined, undefined, undefined, deps);
      expect(group.reply_text).toContain("sadece owner/manager ozel kanalinda");
      expect(store.getLearningCandidate("candidate_owner_text")?.status).toBe("pending_owner_review");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("materializes only after approval and returns durable publish evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "owner-knowledge-wa-apply-"));
    try {
      const bank = resolve(root, "knowledge_bank");
      writeValidKnowledgeBankFixture(bank, { includeTimo: true });
      const store = new ZipIngestionStore(resolve(root, "zip-store.json"));
      seedPending(store);
      const deps = { zipIngestionStore: store, knowledgeBankDir: bank };
      const before = readFileSync(resolve(bank, "app_facts.md"), "utf8");
      const blocked = handleOwnerCommand(ownerMessage("#uygula"), "owner", createTestEnv(), undefined, undefined, undefined, deps);
      expect(blocked.execution_succeeded).toBe(false);
      expect(blocked.reply_text).toContain("onayli bolum yok");
      expect(readFileSync(resolve(bank, "app_facts.md"), "utf8")).toBe(before);

      store.reviewLearningCandidate("candidate_owner_text", "approve", "owner");
      const applied = handleOwnerCommand(ownerMessage("#uygula"), "owner", createTestEnv(), undefined, undefined, undefined, deps);
      expect(applied.execution_succeeded).toBe(true);
      expect(applied.reply_text).toContain("fact_count=");
      expect(applied.reply_text).toContain("activation_status=published_active");
      expect(applied.reply_text).toContain("rollback_pointer=");
      expect(readFileSync(resolve(bank, "app_facts.md"), "utf8")).toContain("Erkek hesap kurali");
      expect(existsSync(resolve(bank, "owner_knowledge_transfer_audit.json"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
