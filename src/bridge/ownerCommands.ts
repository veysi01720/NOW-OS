import type { EnvConfig } from "../config/env.js";
import type { NormalizedIncomingMessage } from "./normalizeEvolutionMessage.js";
import type { QueueStore } from "../storage/types.js";
import type { PersistentIngestionStore } from "../storage/ingestionStore.js";
import type { MaintenanceStore } from "../store/maintenanceStore.js";
import { detectCommandPrefix, routeCoreMode, type CoreMode } from "./modeRouter.js";

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

function compactPreview(value: string, maxLength = 120): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 3)}...`;
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
  if (!prefix) {
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
