import { randomUUID } from "node:crypto";
import { resolve, dirname } from "node:path";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { logger } from "../observability/logger.js";
import type { PersistentIngestionStore } from "../storage/ingestionStore.js";
import type { LearningSuggestion, KnowledgePatch, KnowledgeSyncStatus } from "../storage/ingestionTypes.js";
import { publishStructuredKnowledgeSources } from "./structuredKnowledgePublish.js";

function knowledgeBankDir(): string {
  const dir = process.env.KNOWLEDGE_BANK_DIR
    ? resolve(process.env.KNOWLEDGE_BANK_DIR)
    : resolve("data", "knowledge_bank");
  return dir;
}

function knowledgeBankJsonPath(): string {
  return resolve(knowledgeBankDir(), "approved_learning.json");
}

function knowledgeBankMdPath(): string {
  return resolve(knowledgeBankDir(), "approved_learning.md");
}

export interface KnowledgeSyncContext {
  approved_ready_count: number;
  pending_sync_count: number;
  synced_count: number;
  failed_count: number;
  skipped_count: number;
  latest_sync_activity_at?: string;
  sync_preview: Array<{
    patch_ref: string;
    source_suggestion_ref: string;
    proposed_section: string;
    sanitized_title: string;
    sanitized_content_preview: string;
    knowledge_type: string;
    confidence: number;
    sync_status: string;
  }>;
  action_result?: {
    action: string;
    success: boolean;
    message: string;
    patch_ref?: string;
    previous_status?: string;
    new_status?: string;
  };
  allowed_actions: string[];
  data_quality_notes: string[];
}

export function detectKnowledgeSyncIntent(text: string): boolean {
  const lower = text.toLowerCase();
  if (lower.includes("bilgi bankas") && (lower.includes("aktar") || lower.includes("sync") || lower.includes("guncelle") || lower.includes("gÃ¼ncelle"))) {
    return true;
  }
  const intents = [
    "bilgi bankası durumu",
    "onaylı öğrenmeleri göster",
    "onaylı öğrenmeleri bilgi bankasına aktar",
    "onaylı önerileri senkronize et",
    "bilgi bankasını güncelle",
    "knowledge sync yap",
    "bilgi bankasına aktar",
    "bilgi bankası sync",
    "patch",
    "atla"
  ];
  return intents.some(intent => lower.includes(intent));
}

export function validatePatchSafety(content: string): boolean {
  // Pre-write safety scan
  if (/(?<!\d)(?:\+90|0)?5\d{2}\s?\d{3}\s?\d{2}\s?\d{2}(?!\d)/.test(content)) return false; // Phone (TR focused to avoid date collision)
  if (/\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b/.test(content)) return false; // CC
  if (/@s\.whatsapp\.net|@g\.us/.test(content)) return false; // Raw JID
  if (/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/.test(content)) return false; // UUID
  if (/TR\d{24}/i.test(content.replace(/\s/g, ""))) return false;
  return true;
}

export function validateKnowledgeBankTargetSafety(content: string): boolean {
  // Post-write safety scan (Double-check against JSON/MD outputs)
  return validatePatchSafety(content);
}

export function buildKnowledgePatchFromSuggestion(suggestion: LearningSuggestion, actorRole: string): KnowledgePatch {
  return {
    knowledge_patch_id: randomUUID(),
    patch_ref: "", // Assigned by store during save
    source_suggestion_ref: suggestion.short_ref || "",
    source_suggestion_id_internal: suggestion.suggestion_id,
    proposed_section: suggestion.suggestion_class,
    sanitized_title: `Auto-generated rule for ${suggestion.short_ref}`,
    sanitized_content: suggestion.proposed_text,
    knowledge_type: suggestion.proposed_knowledge_type,
    confidence: suggestion.confidence,
    created_at: new Date().toISOString(),
    created_by_role: actorRole,
    sync_status: "pending_sync"
  };
}

export function writeKnowledgeBankTarget(patches: KnowledgePatch[]): void {
  // Idempotent write: read all synced patches and generate canonical JSON and MD mirror.
  const jsonPath = knowledgeBankJsonPath();
  const mdPath = knowledgeBankMdPath();
  mkdirSync(dirname(jsonPath), { recursive: true });

  const safePatches = patches.filter(p => p.sync_status === "synced");
  
  // Deduplicate by source_suggestion_ref or patch_ref
  const uniquePatches = new Map<string, any>();
  for (const p of safePatches) {
    if (!uniquePatches.has(p.patch_ref)) {
      uniquePatches.set(p.patch_ref, {
        patch_ref: p.patch_ref,
        source_suggestion_ref: p.source_suggestion_ref,
        sanitized_title: p.sanitized_title,
        sanitized_content: p.sanitized_content,
        knowledge_type: p.knowledge_type,
        confidence: p.confidence,
        proposed_section: p.proposed_section,
        synced_at: p.synced_at,
        audit_note_sanitized: p.audit_note
      });
    }
  }

  const exportData = Array.from(uniquePatches.values());
  const jsonContent = JSON.stringify(exportData, null, 2);
  
  if (!validateKnowledgeBankTargetSafety(jsonContent)) {
    throw new Error("Target file safety scan failed. Aborting write to prevent data leak.");
  }
  
  writeFileSync(jsonPath, jsonContent, "utf-8");

  // Write MD mirror
  let mdContent = "# Approved Knowledge Bank\n\n*Auto-generated from approved learning suggestions.*\n\n";
  for (const patch of exportData) {
    mdContent += `## [${patch.patch_ref}] ${patch.sanitized_title}\n`;
    mdContent += `- **Source:** ${patch.source_suggestion_ref}\n`;
    mdContent += `- **Type:** ${patch.knowledge_type}\n`;
    mdContent += `- **Section:** ${patch.proposed_section}\n`;
    mdContent += `- **Synced At:** ${patch.synced_at}\n\n`;
    mdContent += `${patch.sanitized_content}\n\n---\n\n`;
  }
  
  if (!validateKnowledgeBankTargetSafety(mdContent)) {
    throw new Error("Target MD file safety scan failed. Aborting write.");
  }

  writeFileSync(mdPath, mdContent, "utf-8");

  const structuredPublish = publishStructuredKnowledgeSources({ knowledgeBankDir: knowledgeBankDir() });
  logger.info({
    event_type: "STRUCTURED_KNOWLEDGE_PUBLISH_AUDIT",
    action: "publish_derived_structured_sources",
    status: structuredPublish.status,
    app_fact_count: structuredPublish.app_fact_count,
    structured_hash_masked: structuredPublish.structured_hash
      ? `${structuredPublish.structured_hash.slice(0, 4)}***${structuredPublish.structured_hash.slice(-4)}`
      : null,
    routing_rules_hash_masked: structuredPublish.routing_rules_hash
      ? `${structuredPublish.routing_rules_hash.slice(0, 4)}***${structuredPublish.routing_rules_hash.slice(-4)}`
      : null,
  });
}

function logAudit(action: string, actorRole: string, patchRef: string, sourceRef: string, prevStatus: string, newStatus: string, result: string, err?: string) {
  logger.info({
    event_type: "KNOWLEDGE_SYNC_AUDIT",
    action,
    actor_role: actorRole,
    patch_ref: patchRef,
    source_suggestion_ref: sourceRef,
    previous_status: prevStatus,
    new_status: newStatus,
    timestamp: newDateIso(),
    result,
    sanitized_error_if_any: err
  });
}

function newDateIso() {
  return new Date().toISOString();
}

export function handleSyncActions(
  text: string, 
  actorRole: string, 
  store: PersistentIngestionStore, 
  contextResult: Partial<KnowledgeSyncContext>
): void {
  // 1. skip patch
  const skipMatch = text.match(/patch\s+(\d+)\s+atla/i) || text.match(/(KB-\d+)\s+atla/i);
  if (skipMatch) {
    const rawRef = skipMatch[1];
    const ref = rawRef.startsWith("KB-") ? rawRef.toUpperCase() : `KB-${rawRef}`;
    const patch = store.getKnowledgePatchByRef(ref);
    if (patch) {
      const prev = patch.sync_status;
      patch.sync_status = "skipped";
      patch.audit_note = "Skipped by owner command.";
      store.saveKnowledgePatch(patch);
      logAudit("skip_one", actorRole, patch.patch_ref, patch.source_suggestion_ref, prev, "skipped", "success");
      
      contextResult.action_result = {
        action: "skip_one",
        success: true,
        message: `${patch.patch_ref} successfully marked as skipped.`,
        patch_ref: patch.patch_ref,
        previous_status: prev,
        new_status: "skipped"
      };
      return;
    }
  }

  // 2. sync one
  const syncOneMatch = text.match(/(LRN-\d+)\s+bilgi bankasına aktar/i) || text.match(/(KB-\d+)\s+bilgi bankasına aktar/i);
  if (syncOneMatch) {
    const ref = syncOneMatch[1].toUpperCase();
    let patch = store.getKnowledgePatchByRef(ref);
    
    // If it's an LRN, try to find an existing patch, or create one if the suggestion is approved
    if (!patch && ref.startsWith("LRN-")) {
       const suggestion = store.getLearningSuggestionByShortRef(ref);
       if (suggestion && suggestion.status === "approved") {
         patch = buildKnowledgePatchFromSuggestion(suggestion, actorRole);
         store.saveKnowledgePatch(patch); // Generates patch_ref
       }
    }

    if (patch) {
      if (patch.sync_status === "synced") {
         contextResult.action_result = {
           action: "sync_one",
           success: true,
           message: `${patch.patch_ref} is already synced. Ignoring duplicate sync.`
         };
         return;
      }

      if (!validatePatchSafety(patch.sanitized_content) || !validatePatchSafety(patch.sanitized_title)) {
         patch.sync_status = "failed";
         patch.audit_note = "Failed safety scan. Contains forbidden PII or Secrets.";
         store.saveKnowledgePatch(patch);
         logAudit("sync_one", actorRole, patch.patch_ref, patch.source_suggestion_ref, "pending_sync", "failed", "error", patch.audit_note);
         
         contextResult.action_result = {
           action: "sync_one",
           success: false,
           message: `Failed to sync ${patch.patch_ref}: blocked by safety scan.`,
           patch_ref: patch.patch_ref
         };
         return;
      }

      const prev = patch.sync_status;
      patch.sync_status = "synced";
      patch.synced_at = newDateIso();
      patch.audit_note = "Synced securely.";
      store.saveKnowledgePatch(patch);
      
      try {
        writeKnowledgeBankTarget(store.listKnowledgePatches());
        logAudit("sync_one", actorRole, patch.patch_ref, patch.source_suggestion_ref, prev, "synced", "success");
        contextResult.action_result = {
           action: "sync_one",
           success: true,
           message: `${patch.patch_ref} successfully synced to knowledge bank.`,
           patch_ref: patch.patch_ref,
           previous_status: prev,
           new_status: "synced"
        };
      } catch(e: any) {
        patch.sync_status = "failed";
        patch.audit_note = "Failed to write target: " + e.message;
        store.saveKnowledgePatch(patch);
        logAudit("sync_one", actorRole, patch.patch_ref, patch.source_suggestion_ref, "synced", "failed", "error", e.message);
      }
      return;
    }
  }

  // 3. sync approved
  const syncApprovedMatch =
    text.match(/onaylıları bilgi bankasına aktar/i) ||
    text.match(/onaylÄ±larÄ± bilgi bankasÄ±na aktar/i) ||
    text.match(/onaylı öğrenmeleri bilgi bankasına aktar/i) ||
    text.match(/onaylÄ± Ã¶ÄŸrenmeleri bilgi bankasÄ±na aktar/i) ||
    text.match(/onaylı önerileri senkronize et/i) ||
    (text.toLowerCase().includes("bilgi bankas") && text.toLowerCase().includes("aktar"));
  if (syncApprovedMatch) {
    const suggestions = store.listLearningSuggestions().filter(s => s.status === "approved");
    let newlySynced = 0;
    let failedSyncs = 0;
    
    for (const sug of suggestions) {
       let patch = store.listKnowledgePatches().find(p => p.source_suggestion_id_internal === sug.suggestion_id);
       if (!patch) {
         patch = buildKnowledgePatchFromSuggestion(sug, actorRole);
         store.saveKnowledgePatch(patch);
       }
       if (patch.sync_status !== "synced" && patch.sync_status !== "skipped") {
         if (!validatePatchSafety(patch.sanitized_content) || !validatePatchSafety(patch.sanitized_title)) {
           patch.sync_status = "failed";
           patch.audit_note = "Safety scan blocked.";
           failedSyncs++;
         } else {
           patch.sync_status = "synced";
           patch.synced_at = newDateIso();
           patch.audit_note = "Bulk synced securely.";
           newlySynced++;
           logAudit("sync_approved", actorRole, patch.patch_ref, patch.source_suggestion_ref, "pending_sync", "synced", "success");
         }
         store.saveKnowledgePatch(patch);
       }
    }

    try {
      if (newlySynced > 0) {
        writeKnowledgeBankTarget(store.listKnowledgePatches());
      }
      contextResult.action_result = {
         action: "sync_approved",
         success: true,
         message: `${newlySynced} approved items synced securely. ${failedSyncs > 0 ? failedSyncs + " items failed safety checks." : ""}`.trim()
      };
    } catch(e: any) {
      contextResult.action_result = {
         action: "sync_approved",
         success: false,
         message: `Sync failed during write: ${e.message}`
      };
    }
    return;
  }
}

export function buildKnowledgeSyncContext(
  text: string,
  actorRole: string,
  store: PersistentIngestionStore
): KnowledgeSyncContext | undefined {
  if (!detectKnowledgeSyncIntent(text)) return undefined;

  const result: Partial<KnowledgeSyncContext> = {
    allowed_actions: ["preview", "sync_approved", "sync_one", "skip_one"],
    data_quality_notes: []
  };

  handleSyncActions(text, actorRole, store, result);

  // Recalculate context counts and preview
  const patches = store.listKnowledgePatches();
  
  // ensure all approved suggestions have a pending patch at least for preview counting
  const approvedSugs = store.listLearningSuggestions().filter(s => s.status === "approved");
  let pendingCount = patches.filter(p => p.sync_status === "pending_sync").length;
  
  // If an approved suggestion doesn't have a patch yet, it's effectively pending
  const suggestionsWithoutPatch = approvedSugs.filter(s => !patches.some(p => p.source_suggestion_id_internal === s.suggestion_id));
  pendingCount += suggestionsWithoutPatch.length;

  result.approved_ready_count = approvedSugs.length;
  result.pending_sync_count = pendingCount;
  result.synced_count = patches.filter(p => p.sync_status === "synced").length;
  result.failed_count = patches.filter(p => p.sync_status === "failed").length;
  result.skipped_count = patches.filter(p => p.sync_status === "skipped").length;

  const latest = patches.sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  if (latest && latest.synced_at) {
    result.latest_sync_activity_at = latest.synced_at;
  }

  // Previews
  const previews = [];
  for (const patch of patches.filter(p => p.sync_status === "pending_sync")) {
    previews.push({
      patch_ref: patch.patch_ref,
      source_suggestion_ref: patch.source_suggestion_ref,
      proposed_section: patch.proposed_section,
      sanitized_title: patch.sanitized_title,
      sanitized_content_preview: patch.sanitized_content.substring(0, 100) + "...",
      knowledge_type: patch.knowledge_type,
      confidence: patch.confidence,
      sync_status: patch.sync_status
    });
  }

  for (const sug of suggestionsWithoutPatch) {
    previews.push({
      patch_ref: "NOT_CREATED_YET",
      source_suggestion_ref: sug.short_ref || "",
      proposed_section: sug.suggestion_class,
      sanitized_title: "Pending Auto-Generation",
      sanitized_content_preview: sug.proposed_text.substring(0, 100) + "...",
      knowledge_type: sug.proposed_knowledge_type,
      confidence: sug.confidence,
      sync_status: "pending_sync"
    });
  }

  result.sync_preview = previews.slice(0, 5); // limit preview

  if (result.approved_ready_count === 0 && result.synced_count === 0) {
     result.data_quality_notes!.push("There are no approved learning suggestions ready for sync.");
  }

  return result as KnowledgeSyncContext;
}
