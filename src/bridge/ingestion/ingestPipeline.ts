import { createHash, randomUUID } from "node:crypto";
import type { PersistentIngestionStore } from "../../storage/ingestionStore.js";
import type { IngestionJob, IngestionPlatform, LearningSuggestion, NormalizedPlatformMessage } from "../../storage/ingestionTypes.js";
import { sanitizeMessageText } from "./sanitizer.js";
import { classifyMessage } from "./classifier.js";

export interface RawIngestionInput {
  platform: IngestionPlatform;
  source_type: string;
  source_id: string;
  sender_id: string;
  sender_role_guess: string;
  chat_type: string;
  text: string;
  timestamp: string;
  external_message_id: string;
  thread_id: string;
  metadata: Record<string, unknown>;
}

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function ingestPlatformMessage(
  rawInput: RawIngestionInput,
  jobId: string,
  store: PersistentIngestionStore
): void {
  const job = store.getJob(jobId);
  if (!job) {
    throw new Error(`IngestionJob not found: ${jobId}`);
  }

  job.total_messages_seen++;

  const source_id_hash = sha256(rawInput.source_id);
  const sender_id_hash = sha256(rawInput.sender_id);
  const external_message_id_hash = sha256(rawInput.external_message_id);
  const thread_id_hash = rawInput.thread_id ? sha256(rawInput.thread_id) : "";

  const textSanitized = sanitizeMessageText(rawInput.text);
  const textHash = sha256(textSanitized);

  const primaryDedupeKey = `${rawInput.platform}_${external_message_id_hash}`;
  const fallbackDedupeKey = `${rawInput.platform}_${source_id_hash}_${sender_id_hash}_${rawInput.timestamp}_${textHash}`;

  if (store.hasMessageHash(primaryDedupeKey) || store.hasMessageHash(fallbackDedupeKey)) {
    job.total_duplicates_skipped++;
    store.saveJob(job);
    return;
  }

  // Mark as ingested
  store.markMessageHash(primaryDedupeKey);
  store.markMessageHash(fallbackDedupeKey);

  job.total_messages_ingested++;

  const classes = classifyMessage(textSanitized);

  const normalized: NormalizedPlatformMessage = {
    platform: rawInput.platform,
    source_type: rawInput.source_type,
    source_id_hash,
    sender_id_hash,
    sender_role_guess: rawInput.sender_role_guess,
    chat_type: rawInput.chat_type,
    message_text_sanitized: textSanitized,
    timestamp: rawInput.timestamp,
    external_message_id_hash,
    thread_id_hash,
    metadata_sanitized: {} // Mask any raw metadata if necessary
  };

  // Determine if it has learning value (ignore pure unknown or candidate interest)
  const learningClasses = classes.filter(c => c !== "unknown" && c !== "candidate_interest");

  if (learningClasses.length > 0) {
    for (const cls of learningClasses) {
      const suggestion: LearningSuggestion = {
        suggestion_id: `ls_${randomUUID()}`,
        source_job_id: jobId,
        platform: rawInput.platform,
        suggestion_class: cls,
        evidence_preview_sanitized: textSanitized,
        proposed_knowledge_type: "auto_extracted",
        proposed_text: textSanitized,
        confidence: 0.5,
        status: "pending_owner_review",
        created_at: new Date().toISOString()
      };
      store.saveLearningSuggestion(suggestion);
      job.total_learning_suggestions_created++;
    }
  }

  store.saveJob(job);
}
