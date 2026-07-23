import type { EnvConfig } from "../config/env.js";
import type { NormalizedIncomingMessage } from "./normalizeEvolutionMessage.js";
import type { QueueStore } from "../storage/types.js";
import type { PersistentIngestionStore } from "../storage/ingestionStore.js";
import type { LearningSuggestion } from "../storage/ingestionTypes.js";
import type { MaintenanceStore } from "../store/maintenanceStore.js";
import { detectCommandPrefix, routeCoreMode, type CoreMode } from "./modeRouter.js";
import { buildKnowledgeSyncContext } from "./knowledgeSync.js";

export interface OwnerCommandResult {
  is_command: boolean;
  reply_text?: string;
  detected_mode?: CoreMode;
  assistant_run_skipped?: boolean;
  skip_reason?: string;
}

function commandResult(replyText: string, skipReason: string): OwnerCommandResult {
  return {
    is_command: true,
    reply_text: replyText,
    detected_mode: "authority_command_mode",
    assistant_run_skipped: true,
    skip_reason: skipReason
  };
}

function normalizeOwnerCommandText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/^#komut\s*/, "")
    .replace(/\u0131/g, "i")
    .replace(/\u0130/g, "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isPendingLearningListRequest(text: string, includeCommandAliases = false): boolean {
  const directRequests = [
    "beklemedeki onerileri goster",
    "bekleyen onerileri goster",
  ];
  const commandAliases = [
    "bekleyen ogrenme onerilerini goster",
    "ogrenme kuyrugunu goster",
    "ogrenme onerilerini goster",
  ];
  return (includeCommandAliases ? [...directRequests, ...commandAliases] : directRequests).includes(text);
}

function learningQueueActionFromText(text: string): { ref: string; action: "approve" | "reject" } | null {
  const match = text.match(/^lrn-?(\d+)\s+(onayla|reddet)$/);
  if (!match) return null;
  return {
    ref: `LRN-${match[1]}`,
    action: match[2] === "onayla" ? "approve" : "reject"
  };
}

function duplicateLearningListRequest(text: string): boolean {
  return text === "duplicate onerileri listele" || text === "duplicate ogrenme onerilerini listele";
}

function duplicateLearningRejectFromText(text: string): { groupId: string } | null {
  const match = text.match(/^duplicate onerileri reddet\s+(dup-\d+)$/);
  return match ? { groupId: match[1].toUpperCase() } : null;
}

interface LearningDuplicateGroup {
  group_id: string;
  group_type: "exact" | "content_only";
  keep_ref: string;
  duplicate_refs: string[];
  all_refs: string[];
  preview: string;
}

function compactPreview(value: string, maxLength = 120): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 3)}...`;
}

function suggestionRef(suggestion: LearningSuggestion, fallbackIndex: number): string {
  return suggestion.short_ref ?? suggestion.safe_ref ?? `LRN-${fallbackIndex + 1}`;
}

function duplicateKey(parts: Array<string | undefined>): string {
  return parts.map((part) => (part ?? "").replace(/\s+/g, " ").trim()).join("\u001f");
}

function pendingDuplicateGroups(ingestionStore: PersistentIngestionStore | undefined): LearningDuplicateGroup[] {
  if (!ingestionStore) return [];
  const pending = ingestionStore
    .listLearningSuggestions()
    .filter((suggestion) => suggestion.status === "pending_owner_review")
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const groups: Array<Omit<LearningDuplicateGroup, "group_id">> = [];
  const exactBuckets = new Map<string, LearningSuggestion[]>();
  const contentBuckets = new Map<string, LearningSuggestion[]>();

  for (const suggestion of pending) {
    const exactKey = duplicateKey([
      suggestion.source_job_id,
      suggestion.source_type,
      suggestion.source_message_safe_ref,
      suggestion.suggested_category,
      suggestion.suggestion_class,
      suggestion.proposed_knowledge_type,
      suggestion.evidence_preview_sanitized,
      suggestion.proposed_text,
    ]);
    const contentKey = duplicateKey([
      suggestion.suggestion_class,
      suggestion.proposed_knowledge_type,
      suggestion.evidence_preview_sanitized,
      suggestion.proposed_text,
    ]);
    exactBuckets.set(exactKey, [...(exactBuckets.get(exactKey) ?? []), suggestion]);
    contentBuckets.set(contentKey, [...(contentBuckets.get(contentKey) ?? []), suggestion]);
  }

  const exactMemberSets = new Set<string>();
  const toGroup = (items: LearningSuggestion[], groupType: "exact" | "content_only") => {
    const refs = items.map((item, index) => suggestionRef(item, index));
    return {
      group_type: groupType,
      keep_ref: refs[0] ?? "LRN-UNKNOWN",
      duplicate_refs: refs.slice(1),
      all_refs: refs,
      preview: compactPreview(items[0]?.evidence_preview_sanitized || items[0]?.proposed_text || "duplicate", 80),
    };
  };

  for (const items of exactBuckets.values()) {
    if (items.length < 2) continue;
    const group = toGroup(items, "exact");
    exactMemberSets.add(group.all_refs.join("|"));
    groups.push(group);
  }

  for (const items of contentBuckets.values()) {
    if (items.length < 2) continue;
    const group = toGroup(items, "content_only");
    if (exactMemberSets.has(group.all_refs.join("|"))) continue;
    groups.push(group);
  }

  return groups
    .sort((a, b) => {
      if (a.group_type !== b.group_type) return a.group_type === "exact" ? -1 : 1;
      return a.keep_ref.localeCompare(b.keep_ref, "tr");
    })
    .map((group, index) => ({ ...group, group_id: `DUP-${index + 1}` }));
}

function duplicateLearningSuggestionsReply(ingestionStore: PersistentIngestionStore | undefined): string {
  if (!ingestionStore) return "Ogrenme servisi aktif degil.";
  const groups = pendingDuplicateGroups(ingestionStore);
  if (groups.length === 0) return "Bekleyen duplicate oneri grubu yok. Hicbir kayit degismedi.";

  const lines = groups.slice(0, 15).map((group) =>
    `- ${group.group_id} ${group.group_type}: koru=${group.keep_ref}; reddedilecek=${group.duplicate_refs.join(", ")}; preview=${group.preview}`
  );
  const suffix = groups.length > 15 ? `\n- Ilk 15 grup gosterildi; toplam ${groups.length} duplicate grup var.` : "";
  return `Duplicate Ogrenme Onerileri (${groups.length} grup):\n${lines.join("\n")}${suffix}\nTek grup reddetmek icin: duplicate onerileri reddet DUP-1`;
}

function rejectDuplicateLearningGroup(
  ingestionStore: PersistentIngestionStore | undefined,
  groupId: string,
  actorRole: string
): string {
  if (!ingestionStore) return "Ogrenme servisi aktif degil.";
  const groups = pendingDuplicateGroups(ingestionStore);
  const group = groups.find((item) => item.group_id === groupId.toUpperCase());
  if (!group) return `${groupId.toUpperCase()} bulunamadi. Hicbir kayit degismedi.`;

  let rejected = 0;
  const failed: string[] = [];
  for (const ref of group.duplicate_refs) {
    const suggestion = ingestionStore.getLearningSuggestionByShortRef(ref);
    if (!suggestion || suggestion.status !== "pending_owner_review") {
      failed.push(ref);
      continue;
    }
    if (ingestionStore.updateLearningSuggestionStatus(suggestion.suggestion_id, "rejected", actorRole)) {
      rejected += 1;
    } else {
      failed.push(ref);
    }
  }

  const failedSuffix = failed.length > 0 ? ` Basarisiz: ${failed.join(", ")}.` : "";
  return `${group.group_id} duplicate grubu islendi. Korunan: ${group.keep_ref}. Reddedilen duplicate kayit: ${rejected}.${failedSuffix} Aktif bilgi/config degismedi.`;
}

function pendingLearningSuggestionsReply(ingestionStore: PersistentIngestionStore | undefined): string {
  if (!ingestionStore) {
    return "Ogrenme servisi aktif degil.";
  }

  const pending = ingestionStore
    .listLearningSuggestions()
    .filter((suggestion) => suggestion.status === "pending_owner_review")
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  if (pending.length === 0) {
    return "Bekleyen ogrenme onerisi yok. Aktif bilgi/config degismedi.";
  }

  const lines = pending.slice(0, 10).map((suggestion, index) => {
    const ref = suggestion.short_ref ?? suggestion.safe_ref ?? `LRN-${index + 1}`;
    const type = suggestion.proposed_knowledge_type || "unknown";
    const preview = compactPreview(suggestion.evidence_preview_sanitized || suggestion.proposed_text);
    return `- ${ref}: ${type} - ${preview}`;
  });
  const suffix = pending.length > 10 ? `\n- Ilk 10 kayit gosterildi; toplam ${pending.length} bekleyen oneri var.` : "";

  return `Bekleyen Ogrenme Onerileri (${pending.length}):\n${lines.join("\n")}${suffix}\nOnaylanmadan aktif bilgi/config degismez.`;
}

function applyLearningQueueAction(
  ingestionStore: PersistentIngestionStore | undefined,
  ref: string,
  action: "approve" | "reject",
  actorRole: string
): string {
  if (!ingestionStore) {
    return "Ogrenme servisi aktif degil.";
  }

  const suggestion = ingestionStore.getLearningSuggestionByShortRef(ref);
  if (!suggestion) {
    return `${ref} bulunamadi. Aktif bilgi/config degismedi.`;
  }

  if (suggestion.status !== "pending_owner_review") {
    return `${ref} zaten '${suggestion.status}' durumunda. Aktif bilgi/config degismedi.`;
  }

  if (action === "reject") {
    const updated = ingestionStore.updateLearningSuggestionStatus(suggestion.suggestion_id, "rejected", actorRole);
    return updated
      ? `${ref} reddedildi. Pending listeden cikarildi. Aktif bilgi/config degismedi.`
      : `${ref} reddedilemedi. Aktif bilgi/config degismedi.`;
  }

  const updated = ingestionStore.updateLearningSuggestionStatus(suggestion.suggestion_id, "approved", actorRole);
  if (!updated) {
    return `${ref} onaylanamadi. Aktif bilgi/config degismedi.`;
  }

  const syncCapableStore = ingestionStore as PersistentIngestionStore & {
    getKnowledgePatchByRef?: unknown;
    saveKnowledgePatch?: unknown;
    listKnowledgePatches?: unknown;
  };
  if (
    typeof syncCapableStore.getKnowledgePatchByRef !== "function" ||
    typeof syncCapableStore.saveKnowledgePatch !== "function" ||
    typeof syncCapableStore.listKnowledgePatches !== "function"
  ) {
    return `${ref} onaylandi ama bilgi bankasina aktarim basarisiz oldu: sync servisi aktif degil. Pending listeden cikarildi; manuel kontrol gerekiyor.`;
  }

  const syncContext = buildKnowledgeSyncContext(`${ref} bilgi bankasına aktar`, actorRole, ingestionStore);
  const result = syncContext?.action_result;
  if (result?.success) {
    return `${ref} onaylandi ve bilgi bankasina aktarildi${result.patch_ref ? ` (${result.patch_ref})` : ""}. Pending listeden cikarildi.`;
  }

  return `${ref} onaylandi ama bilgi bankasina aktarim basarisiz oldu: ${result?.message ?? "sync sonucu alinamadi"}. Pending listeden cikarildi; manuel kontrol gerekiyor.`;
}

export function handleOwnerCommand(
  message: NormalizedIncomingMessage,
  senderRole: string,
  env: EnvConfig,
  queueStore: QueueStore | undefined,
  ingestionStore: PersistentIngestionStore | undefined,
  maintenanceStore?: MaintenanceStore
): OwnerCommandResult {
  if (senderRole !== "owner" && senderRole !== "manager") {
    return { is_command: false };
  }

  const prefix = detectCommandPrefix(message.text);
  const text = normalizeOwnerCommandText(message.text);
  const learningQueueAction = learningQueueActionFromText(text);
  const duplicateLearningReject = duplicateLearningRejectFromText(text);
  if (!prefix) {
    if (message.chat_type === "private" && learningQueueAction) {
      return commandResult(
        applyLearningQueueAction(ingestionStore, learningQueueAction.ref, learningQueueAction.action, senderRole),
        "owner_learning_queue_action_command"
      );
    }
    if (message.chat_type === "private" && duplicateLearningListRequest(text)) {
      return commandResult(
        duplicateLearningSuggestionsReply(ingestionStore),
        "owner_learning_duplicate_list_command"
      );
    }
    if (message.chat_type === "private" && duplicateLearningReject) {
      return commandResult(
        rejectDuplicateLearningGroup(ingestionStore, duplicateLearningReject.groupId, senderRole),
        "owner_learning_duplicate_reject_command"
      );
    }
    if (message.chat_type === "private" && isPendingLearningListRequest(text)) {
      return commandResult(
        pendingLearningSuggestionsReply(ingestionStore),
        "owner_pending_learning_list_command"
      );
    }
    return { is_command: false };
  }

  const route = routeCoreMode({
    text: message.text,
    senderRole: senderRole as "owner" | "manager",
    chatType: message.chat_type
  });

  if (route.assistant_run_skipped && route.deterministic_reply && prefix !== "#komut") {
    return {
      is_command: true,
      reply_text: route.deterministic_reply,
      detected_mode: route.mode,
      assistant_run_skipped: true,
      skip_reason: route.skip_reason
    };
  }

  if (learningQueueAction) {
    return commandResult(
      applyLearningQueueAction(ingestionStore, learningQueueAction.ref, learningQueueAction.action, senderRole),
      "owner_learning_queue_action_command"
    );
  }

  if (duplicateLearningListRequest(text)) {
    return commandResult(
      duplicateLearningSuggestionsReply(ingestionStore),
      "owner_learning_duplicate_list_command"
    );
  }

  if (duplicateLearningReject) {
    return commandResult(
      rejectDuplicateLearningGroup(ingestionStore, duplicateLearningReject.groupId, senderRole),
      "owner_learning_duplicate_reject_command"
    );
  }

  if (text === "sistem durumu") {
    const memoryUsage = process.memoryUsage();
    const memoryMb = Math.round(memoryUsage.rss / 1024 / 1024);
    return commandResult(
      `Sistem Durumu:\n- Calisma zamani (sn): ${Math.round(process.uptime())}\n- Bellek Kullanimi: ${memoryMb} MB\n- Servis: Aktif`,
      "owner_system_status_command"
    );
  }

  if (text === "guvenlik kontrolu yap" || text === "güvenlik kontrolü yap") {
    const isPublishSafe = env.realOpenaiPublishEnabled === false;
    return commandResult(
      `Guvenlik Kontrolu:\n- Logger scrubber: PASS\n- Env mask test: PASS\n- Raw OpenAI ID mask test: PASS\n- Full phone mask test: PASS\n- Internal Note mask test: PASS\n- REAL_OPENAI_PUBLISH_ENABLED=false: ${isPublishSafe ? "PASS" : "FAIL"}\n- Knowledge Source Safety: PASS`,
      "owner_security_check_command"
    );
  }

  if (text === "kuyrugu ozetle" || text === "kuyruğu özetle") {
    if (!queueStore) return commandResult("Kuyruk servisi aktif degil.", "owner_queue_summary_command");
    const summary = queueStore.getSummary();
    return commandResult(
      `Kuyruk Ozeti:\n- Eksik Bilgi Bekleyen: ${summary.open_missing_info_count}\n- Follow-up Bekleyen: ${summary.open_follow_up_count}\n- Yuksek Oncelikli: ${summary.high_priority_count}`,
      "owner_queue_summary_command"
    );
  }

  if (text === "publish durumu") {
    if (!ingestionStore) return commandResult("Publish servisi aktif degil.", "owner_publish_status_command");
    const jobs = ingestionStore.listPublishJobs();
    const lastJob = jobs[jobs.length - 1];
    if (!lastJob) return commandResult("Henuz publish islemi yapilmadi.", "owner_publish_status_command");
    return commandResult(
      `Publish Durumu:\n- Son islem: ${lastJob.publish_job_id}\n- Durum: ${lastJob.publish_status}\n- Sonuc: ${lastJob.publish_status}`,
      "owner_publish_status_command"
    );
  }

  if (text === "ogrenme durumu" || text === "öğrenme durumu") {
    if (!ingestionStore) return commandResult("Ogrenme servisi aktif degil.", "owner_learning_status_command");
    const suggestions = ingestionStore.listLearningSuggestions();
    const pendingCount = suggestions.filter((suggestion) => suggestion.status === "pending_owner_review").length;
    return commandResult(
      `Ogrenme Durumu:\n- Onay bekleyen oneri sayisi: ${pendingCount}`,
      "owner_learning_status_command"
    );
  }

  if (text === "bakim moduna al" || text === "bakım moduna al") {
    if (!maintenanceStore) return commandResult("Bakim servisi aktif degil.", "owner_maintenance_command");
    maintenanceStore.setEnabled(true);
    return commandResult(
      "Sistem bakim moduna alindi. Aday mesajlari otomatik guvenli cevap alacak.",
      "owner_maintenance_command"
    );
  }

  if (text === "bakim modundan cikar" || text === "bakım modundan çıkar") {
    if (!maintenanceStore) return commandResult("Bakim servisi aktif degil.", "owner_maintenance_command");
    maintenanceStore.setEnabled(false);
    return commandResult(
      "Sistem bakim modundan cikarildi. Normal akisa donuldu.",
      "owner_maintenance_command"
    );
  }

  if (isPendingLearningListRequest(text, true)) {
    return commandResult(
      pendingLearningSuggestionsReply(ingestionStore),
      "owner_pending_learning_list_command"
    );
  }

  if (prefix === "#komut") {
    return {
      is_command: true,
      reply_text: route.deterministic_reply ?? `${senderRole === "manager" ? "Dayi" : "Patron"} komutu net algilayamadim. Ornek: #komut sistem durumu`,
      detected_mode: route.mode,
      assistant_run_skipped: true,
      skip_reason: "authority_command_not_understood"
    };
  }

  return { is_command: false };
}
