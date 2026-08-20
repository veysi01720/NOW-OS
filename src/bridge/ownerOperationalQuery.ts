import { createHash } from "node:crypto";
import type { HumanHandoffStore } from "../store/humanHandoffStore.js";
import type { ReportDataSource } from "../storage/types.js";
import type { OwnerNaturalLanguageDecision } from "./ownerNaturalLanguageIntent.js";

export interface OwnerOperationalQueryResult {
  reply: string;
  executionSucceeded: boolean;
  queryKind: NonNullable<OwnerNaturalLanguageDecision["operational_query_kind"]> | "unknown";
  evidenceIds: string[];
  timeWindowMinutes: number;
}

function safeWindow(value: number | null | undefined): number {
  if (!Number.isFinite(value)) return 1_440;
  return Math.max(1, Math.min(10_080, Math.round(value as number)));
}

function windowLabel(minutes: number): string {
  if (minutes < 60) return `son ${minutes} dakika`;
  if (minutes % 1_440 === 0) return `son ${minutes / 1_440} gün`;
  if (minutes % 60 === 0) return `son ${minutes / 60} saat`;
  return `son ${minutes} dakika`;
}

function evidenceId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function address(actorRole: "owner" | "manager"): string {
  return actorRole === "owner" ? "Arda, " : "";
}

export function executeOwnerOperationalQuery(input: {
  decision: OwnerNaturalLanguageDecision;
  actorRole: "owner" | "manager";
  reportDataSource?: ReportDataSource;
  humanHandoffStore?: HumanHandoffStore;
  now?: Date;
}): OwnerOperationalQueryResult {
  const queryKind = input.decision.operational_query_kind ?? "unknown";
  const timeWindowMinutes = safeWindow(input.decision.operational_time_window_minutes);
  const prefix = address(input.actorRole);

  if (queryKind === "recent_inbound_activity") {
    if (!input.reportDataSource?.listRecentInboundActivity) {
      return {
        reply: `${prefix}canlı aday hareketi verisine şu an ulaşamıyorum; bu yüzden mesaj yok diyemem.`,
        executionSucceeded: false,
        queryKind,
        evidenceIds: [],
        timeWindowMinutes,
      };
    }
    const now = input.now ?? new Date();
    const since = new Date(now.getTime() - timeWindowMinutes * 60_000).toISOString();
    const activity = input.reportDataSource.listRecentInboundActivity(since);
    const snapshotEvidence = evidenceId(`recent_inbound_activity|${since}|${activity.length}`);
    if (activity.length === 0) {
      return {
        reply: `${prefix}${windowLabel(timeWindowMinutes)} içinde kayda giren yeni aday mesajı görünmüyor.`,
        executionSucceeded: true,
        queryKind,
        evidenceIds: [snapshotEvidence],
        timeWindowMinutes,
      };
    }
    const latest = activity[0];
    const successfulReplies = activity.filter((item) => item.sendtext_status === "success").length;
    const latestAt = new Date(latest.occurred_at).toLocaleTimeString("tr-TR", {
      timeZone: "Europe/Istanbul",
      hour: "2-digit",
      minute: "2-digit",
    });
    const sender = latest.sender_last4 ? ` Son mesaj ${latest.sender_last4} ile biten hattan` : " Son mesaj";
    return {
      reply: `${prefix}evet; ${windowLabel(timeWindowMinutes)} içinde ${activity.length} aday mesajı kayda girdi.${sender} ${latestAt}'te geldi. ${successfulReplies}/${activity.length} mesajda bot yanıtı başarıyla gönderildi.`,
      executionSucceeded: true,
      queryKind,
      evidenceIds: [snapshotEvidence, ...activity.map((item) => evidenceId(item.evidence_id))],
      timeWindowMinutes,
    };
  }

  if (queryKind === "candidate_overview") {
    if (!input.reportDataSource) {
      return {
        reply: `${prefix}aday durum verisine şu an ulaşamıyorum; kesin sayı söylemeyeceğim.`,
        executionSucceeded: false,
        queryKind,
        evidenceIds: [],
        timeWindowMinutes,
      };
    }
    const states = input.reportDataSource.listCandidateStates();
    const active = states.filter((item) => item.current_state !== "TRAINING_DONE").length;
    const installation = states.filter((item) => item.current_state === "INSTALLATION_IN_PROGRESS").length;
    return {
      reply: `${prefix}kayıtlarda ${states.length} aday var; ${active} kayıt aktif akışta, ${installation} aday kurulum aşamasında.`,
      executionSucceeded: true,
      queryKind,
      evidenceIds: [evidenceId(`candidate_overview|${states.length}|${active}|${installation}`)],
      timeWindowMinutes,
    };
  }

  if (queryKind === "pending_handoffs") {
    if (!input.humanHandoffStore) {
      return {
        reply: `${prefix}bekleyen devir kayıtlarına şu an ulaşamıyorum; kesin durum söylemeyeceğim.`,
        executionSucceeded: false,
        queryKind,
        evidenceIds: [],
        timeWindowMinutes,
      };
    }
    const pending = input.humanHandoffStore.list().filter((item) => item.status === "pending");
    return {
      reply: pending.length === 0
        ? `${prefix}şu an bekleyen insan devri veya owner yanıtı görünmüyor.`
        : `${prefix}şu an ${pending.length} bekleyen insan devri/owner yanıtı var.`,
      executionSucceeded: true,
      queryKind,
      evidenceIds: [evidenceId(`pending_handoffs|${pending.map((item) => item.handoff_id).sort().join("|")}`)],
      timeWindowMinutes,
    };
  }

  return {
    reply: `${prefix}hangi canlı durumu sorduğunu netleştiremedim. Yeni mesajları mı, aday durumlarını mı, yoksa bekleyen devirleri mi kontrol edeyim?`,
    executionSucceeded: false,
    queryKind: "unknown",
    evidenceIds: [],
    timeWindowMinutes,
  };
}
