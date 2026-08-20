import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Logger } from "../observability/logger.js";
import type { HumanHandoffStore } from "../store/humanHandoffStore.js";
import type { InstallationVerificationReviewStore } from "../store/installationVerificationReviewStore.js";
import type { ActionAuditStore } from "../store/actionAuditStore.js";
import type { ReportDataSource } from "../storage/types.js";
import { matchesNormalizedHint } from "../utils/textNormalization.js";
import type { NormalizedIncomingMessage } from "./normalizeEvolutionMessage.js";
import { createDirectOwnerKnowledgeReview } from "./ownerKnowledgeIntake.js";
import {
  materializeApprovedOwnerKnowledge,
  rollbackLastOwnerKnowledge,
} from "./ownerKnowledgeTransfer.js";
import type {
  OwnerNaturalLanguageDecision,
  OwnerNaturalLanguageIntentClassifier,
} from "./ownerNaturalLanguageIntent.js";
import type { ZipLearningCandidateRecord } from "./zipIngestion/types.js";
import type { ZipIngestionStore } from "./zipIngestion/store.js";

export interface OwnerNaturalLanguageFlowResult {
  handled: boolean;
  reply?: string;
  executionSucceeded?: boolean;
  eventType?: string;
}

export interface OwnerNaturalLanguageFlowDeps {
  classifier?: OwnerNaturalLanguageIntentClassifier;
  zipStore?: ZipIngestionStore;
  knowledgeBankDir?: string;
  actionAuditStore?: ActionAuditStore;
  humanHandoffStore?: HumanHandoffStore;
  installationReviewStore?: InstallationVerificationReviewStore;
  reportDataSource?: ReportDataSource;
  sourceInstance: string;
  logger: Logger;
  sendToCandidate(phone: string, text: string): Promise<void>;
}

function knowledgeDir(value: string | undefined): string {
  return resolve(value ?? process.env.KNOWLEDGE_BANK_DIR ?? resolve("data", "knowledge_bank"));
}

function activeKnowledge(value: string | undefined): string {
  const path = resolve(knowledgeDir(value), "app_facts.md");
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function candidateRef(candidate: ZipLearningCandidateRecord): string {
  return candidate.section_id ?? candidate.id;
}

function pendingCandidates(store: ZipIngestionStore | undefined): ZipLearningCandidateRecord[] {
  return (store?.listLearningCandidates() ?? [])
    .filter((candidate) => candidate.status === "pending_owner_review")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function pendingCandidateSuffixes(deps: OwnerNaturalLanguageFlowDeps): string[] {
  return [...new Set([
    ...(deps.humanHandoffStore?.listPendingOwnerQueries().map((item) => item.owner_query?.candidate_phone.slice(-4)) ?? []),
    ...(deps.installationReviewStore?.list().filter((item) => item.decision === "pending").map((item) => item.candidate_phone_last4) ?? []),
  ].filter((value): value is string => Boolean(value)))];
}

function latestSinglePendingDirect(store: ZipIngestionStore): ZipLearningCandidateRecord | null {
  const pending = pendingCandidates(store).filter((candidate) => candidate.source === "owner_direct_text");
  if (pending.length === 0) return null;
  const latestJob = pending[0].source_job_id;
  const inLatestJob = pending.filter((candidate) => candidate.source_job_id === latestJob);
  return inLatestJob.length === 1 ? inLatestJob[0] : null;
}

function publishCandidate(input: {
  candidate: ZipLearningCandidateRecord;
  store: ZipIngestionStore;
  deps: OwnerNaturalLanguageFlowDeps;
  actorRole: "owner" | "manager";
}): OwnerNaturalLanguageFlowResult {
  const approved = input.store.reviewLearningCandidate(input.candidate.id, "approve", input.actorRole);
  if (approved?.status !== "approved_for_bundle") {
    return { handled: true, reply: "Bilgiyi onaylayamadım; aktif bilgi değişmedi.", executionSucceeded: false, eventType: "OWNER_NATURAL_KNOWLEDGE_APPROVAL_FAILED" };
  }
  const result = materializeApprovedOwnerKnowledge({
    jobId: input.candidate.source_job_id,
    zipStore: input.store,
    knowledgeBankDir: input.deps.knowledgeBankDir,
    actionAuditStore: input.deps.actionAuditStore,
    actorRole: input.actorRole,
  });
  if (result.status !== "published" || !result.verification) {
    return { handled: true, reply: `Bilgiyi kayda hazırladım ama yayın doğrulaması geçmedi; aktif bilgi değişmedi. Hata: ${result.error_code ?? result.status}.`, executionSucceeded: false, eventType: "OWNER_NATURAL_KNOWLEDGE_PUBLISH_FAILED" };
  }
  return {
    handled: true,
    reply: `Bilgi aktif edildi. Alanlar: ${result.verification.structured_fields.join(", ")}; kullanım yolları: ${result.verification.context_paths.join(", ")}; aktif sürüm=${result.active_version_hash_masked}; geri alma kaydı hazır.`,
    executionSucceeded: true,
    eventType: "OWNER_NATURAL_KNOWLEDGE_PUBLISHED",
  };
}

function resolveCandidatePhone(reference: string | null, deps: OwnerNaturalLanguageFlowDeps): string | null {
  const digits = (reference ?? "").replace(/\D/g, "");
  const known = new Set<string>();
  for (const state of deps.reportDataSource?.listCandidateStates() ?? []) known.add(state.user_id.replace(/\D/g, ""));
  for (const item of deps.humanHandoffStore?.listPendingOwnerQueries() ?? []) {
    if (item.owner_query) known.add(item.owner_query.candidate_phone.replace(/\D/g, ""));
  }
  for (const item of deps.installationReviewStore?.list() ?? []) known.add(item.candidate_phone.replace(/\D/g, ""));
  if (digits.length >= 10) return digits;
  if (digits.length === 4) {
    const matches = [...known].filter((phone) => phone.endsWith(digits));
    return matches.length === 1 ? matches[0] : null;
  }
  const pending = deps.humanHandoffStore?.listPendingOwnerQueries() ?? [];
  return pending.length === 1 ? pending[0].owner_query?.candidate_phone ?? null : null;
}

function matchingPendingCandidate(store: ZipIngestionStore, value: string): ZipLearningCandidateRecord | undefined {
  const normalized = value.trim().toLocaleLowerCase("tr-TR");
  return pendingCandidates(store).find((candidate) => [
    candidate.id,
    candidate.section_id,
    candidate.section_title,
  ].some((field) => field?.toLocaleLowerCase("tr-TR") === normalized));
}

function handleZipSelection(
  decision: OwnerNaturalLanguageDecision,
  deps: OwnerNaturalLanguageFlowDeps,
  actorRole: "owner" | "manager",
): OwnerNaturalLanguageFlowResult {
  const store = deps.zipStore;
  if (!store) return { handled: true, reply: "Bilgi inceleme servisi hazır değil; hiçbir bölüm değişmedi.", executionSucceeded: false };
  const pendingZip = pendingCandidates(store).filter((candidate) => candidate.source === "zip_ingestion");
  const selectedValues = decision.selected_section_ids.includes("ALL")
    ? pendingZip.map(candidateRef)
    : decision.selected_section_ids;
  const selected = selectedValues.map((value) => matchingPendingCandidate(store, value)).filter((value): value is ZipLearningCandidateRecord => Boolean(value));
  const rejected = decision.rejected_section_ids.map((value) => matchingPendingCandidate(store, value)).filter((value): value is ZipLearningCandidateRecord => Boolean(value));
  if (selected.length === 0 && rejected.length === 0) {
    return { handled: true, reply: "Hangi bölümleri istediğini netleştiremedim. Bölüm başlıklarını söyle; aktif bilgi değişmedi.", executionSucceeded: false };
  }
  for (const candidate of selected) store.reviewLearningCandidate(candidate.id, "approve", actorRole);
  for (const candidate of rejected) store.reviewLearningCandidate(candidate.id, "reject", actorRole);
  if (!decision.apply_selection) {
    return { handled: true, reply: `${selected.length} bölüm seçildi, ${rejected.length} bölüm reddedildi. Uygulamamı istediğinde doğal dille söyleyebilirsin; henüz aktif bilgi değişmedi.`, executionSucceeded: true };
  }
  const jobIds = [...new Set(selected.map((candidate) => candidate.source_job_id))];
  const results = jobIds.map((jobId) => materializeApprovedOwnerKnowledge({ jobId, zipStore: store, knowledgeBankDir: deps.knowledgeBankDir, actionAuditStore: deps.actionAuditStore, actorRole }));
  const failed = results.filter((result) => result.status !== "published");
  if (failed.length > 0) return { handled: true, reply: "Seçim kaydedildi ancak yayın doğrulaması tamamlanmadı; başarısız yayın için aktif bilgi korunuyor.", executionSucceeded: false };
  return { handled: true, reply: `${selected.length} seçili bölüm doğrulanarak aktif edildi; ${rejected.length} bölüm dışarıda bırakıldı. Geri alma kaydı hazır.`, executionSucceeded: true, eventType: "OWNER_NATURAL_ZIP_SELECTION_PUBLISHED" };
}

export async function handleOwnerNaturalLanguage(
  message: NormalizedIncomingMessage,
  actorRole: "owner" | "manager",
  deps: OwnerNaturalLanguageFlowDeps,
): Promise<OwnerNaturalLanguageFlowResult> {
  if (!deps.classifier || message.chat_type !== "private") return { handled: false };
  const pending = pendingCandidates(deps.zipStore);
  let decision: OwnerNaturalLanguageDecision;
  const pendingDirect = deps.zipStore ? latestSinglePendingDirect(deps.zipStore) : null;
  const confirmationHint = pendingDirect && matchesNormalizedHint(message.text, ["onaylandi", "evet", "dogru", "aynen", "tamam"]);
  const rejectionHint = pendingDirect && matchesNormalizedHint(message.text, ["hayir", "iptal", "reddet"], { strict: true });
  if (confirmationHint || rejectionHint) {
    decision = {
      intent: confirmationHint ? "confirm_pending_knowledge" : "reject_pending_knowledge",
      confidence: 1,
      knowledge_text: null,
      candidate_reference: null,
      relay_text: null,
      conflict_detected: false,
      ambiguity_detected: false,
      clarification_question: null,
      selected_section_ids: [],
      rejected_section_ids: [],
      apply_selection: false,
    };
  } else try {
    decision = await deps.classifier.classify({
      message: message.text,
      activeKnowledge: activeKnowledge(deps.knowledgeBankDir),
      pendingKnowledge: pending.map((candidate) => ({ id: candidateRef(candidate), title: candidate.section_title ?? candidateRef(candidate), classification: candidate.classification ?? "information" })),
      pendingCandidateSuffixes: pendingCandidateSuffixes(deps),
    });
  } catch (error) {
    deps.logger.warn({ event_type: "OWNER_NATURAL_INTENT_CLASSIFICATION_FAILED", correlation_id: message.correlation_id, error: error instanceof Error ? error.message : String(error), raw_text_logged: false });
    return { handled: true, reply: "Mesajının bilgi, yönlendirme veya sohbet niyetini güvenle ayıramadım. Bir cümleyle biraz daha açık söyler misin? Hiçbir bilgi veya aday mesajı değiştirilmedi.", executionSucceeded: false, eventType: "OWNER_NATURAL_INTENT_CLASSIFICATION_FAILED" };
  }
  deps.logger.info({
    event_type: "OWNER_NATURAL_INTENT_CLASSIFIED",
    correlation_id: message.correlation_id,
    intent: decision.intent,
    confidence: decision.confidence,
    conflict_detected: decision.conflict_detected,
    ambiguity_detected: decision.ambiguity_detected,
    raw_text_logged: false,
  });

  if (decision.confidence < 0.65) {
    return { handled: true, reply: decision.clarification_question ?? "Ne yapmamı istediğini güvenle ayıramadım. Bilgi mi ekliyorsun, bir adaya mesaj mı iletiyorsun?", executionSucceeded: false, eventType: "OWNER_NATURAL_INTENT_LOW_CONFIDENCE" };
  }
  if (decision.intent === "normal_chat") return { handled: false };
  if (decision.intent === "rollback_last_knowledge") {
    if (!deps.zipStore) return { handled: true, reply: "Geri alma kaydı servisi hazır değil; aktif bilgi değişmedi.", executionSucceeded: false };
    const result = rollbackLastOwnerKnowledge({ zipStore: deps.zipStore, knowledgeBankDir: deps.knowledgeBankDir, actionAuditStore: deps.actionAuditStore, actorRole });
    return result.status === "rolled_back"
      ? { handled: true, reply: `Son bilgi değişikliği geri alındı; aktif sürüm=${result.active_version_hash_masked}; fact_count=${result.fact_count}.`, executionSucceeded: true, eventType: "OWNER_NATURAL_KNOWLEDGE_ROLLED_BACK" }
      : { handled: true, reply: result.status === "not_available" ? "Geri alınabilecek son bilgi değişikliği bulunamadı." : `Geri alma tamamlanamadı; aktif bilgi korunuyor. Hata: ${result.error_code ?? result.status}.`, executionSucceeded: false };
  }
  if (decision.intent === "candidate_relay") {
    const phone = resolveCandidatePhone(decision.candidate_reference, deps);
    if (!phone || !decision.relay_text?.trim()) return { handled: true, reply: "Hangi adaya ne ileteceğini netleştiremedim; hiçbir mesaj gönderilmedi.", executionSucceeded: false };
    try {
      await deps.sendToCandidate(phone, decision.relay_text.trim());
    } catch (error) {
      deps.logger.error({ event_type: "OWNER_NATURAL_RELAY_FAILED", correlation_id: message.correlation_id, candidate_last4: phone.slice(-4), error: error instanceof Error ? error.message : String(error), raw_text_logged: false });
      return { handled: true, reply: `Mesaj adayın ${phone.slice(-4)} ile biten hattına iletilemedi; gönderilmiş saymadım.`, executionSucceeded: false, eventType: "OWNER_NATURAL_RELAY_FAILED" };
    }
    const pendingQuery = deps.humanHandoffStore?.listPendingOwnerQueries().find((item) => item.owner_query?.candidate_phone === phone);
    if (pendingQuery) deps.humanHandoffStore?.resolveOwnerQuery(pendingQuery.handoff_id);
    return { handled: true, reply: `Mesaj adayın ${phone.slice(-4)} ile biten hattına iletildi.`, executionSucceeded: true, eventType: "OWNER_NATURAL_RELAY_SENT" };
  }
  if (decision.intent === "zip_review_selection") return handleZipSelection(decision, deps, actorRole);
  if (!deps.zipStore) return { handled: true, reply: "Bilgi servisi hazır değil; aktif bilgi değişmedi.", executionSucceeded: false };
  if (decision.intent === "confirm_pending_knowledge" || decision.intent === "reject_pending_knowledge") {
    const candidate = latestSinglePendingDirect(deps.zipStore);
    if (!candidate) return { handled: true, reply: "Tek ve net bir bekleyen bilgi teyidi bulunamadı; aktif bilgi değişmedi.", executionSucceeded: false };
    if (decision.intent === "reject_pending_knowledge") {
      deps.zipStore.reviewLearningCandidate(candidate.id, "reject", actorRole, "natural_language_rejection");
      return { handled: true, reply: "Bekleyen bilgi iptal edildi; aktif bilgi değişmedi.", executionSucceeded: true, eventType: "OWNER_NATURAL_KNOWLEDGE_REJECTED" };
    }
    return publishCandidate({ candidate, store: deps.zipStore, deps, actorRole });
  }
  const knowledgeText = decision.knowledge_text?.trim();
  if (!knowledgeText) return { handled: true, reply: decision.clarification_question ?? "Verdiğin bilginin tam olarak neyi değiştirdiğini netleştirir misin?", executionSucceeded: false };
  const direct = createDirectOwnerKnowledgeReview({ text: knowledgeText, senderRole: actorRole, senderPhone: message.phone_number, sourceInstance: deps.sourceInstance, zipStore: deps.zipStore, logger: deps.logger });
  if (direct.status === "duplicate") return { handled: true, reply: "Bu bilgi daha önce kaydedilmiş veya işlenmiş; yeni bir değişiklik yapılmadı.", executionSucceeded: true, eventType: "OWNER_NATURAL_KNOWLEDGE_DUPLICATE" };
  if (direct.status === "rejected" || !direct.result) return { handled: true, reply: "Bilgiyi anlamlı bir kayıt olarak ayıramadım; aktif bilgi değişmedi. Biraz daha açık söyler misin?", executionSucceeded: false };
  if (direct.result.candidates.length !== 1) {
    return { handled: true, reply: `${direct.result.candidates.length} ayrı bölüm buldum. Hangilerini istediğini başlıklarıyla söyle; henüz aktif bilgi değişmedi.`, executionSucceeded: true, eventType: "OWNER_NATURAL_MULTI_SECTION_REVIEW_CREATED" };
  }
  if (decision.conflict_detected || decision.ambiguity_detected) {
    return { handled: true, reply: decision.clarification_question ?? "Bu bilgi mevcut kuralla çelişiyor veya anlamı net değil. Değişikliği aynen onaylıyor musun?", executionSucceeded: false, eventType: "OWNER_NATURAL_KNOWLEDGE_CLARIFICATION_REQUIRED" };
  }
  return publishCandidate({ candidate: direct.result.candidates[0], store: deps.zipStore, deps, actorRole });
}
