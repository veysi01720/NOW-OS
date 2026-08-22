export type CandidateKnowledgeStage = "intake" | "app_selection" | "installation" | "training";

export type KnowledgeSectionClassification = "information" | "constraint" | "critical" | "training" | "rate_sensitive" | "archive";

export interface KnowledgeSectionUsage {
  candidate_context: boolean;
  stages: CandidateKnowledgeStage[];
  topic: string;
}

const ALL_CANDIDATE_STAGES: CandidateKnowledgeStage[] = ["intake", "app_selection", "installation", "training"];

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ı/gu, "i")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function includesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function isPostInstallationTrainingTitle(title: string): boolean {
  const normalizedTitle = normalize(title);
  return includesAny(normalizedTitle, [
    /(?:^|\s)egitim(?:\s|$)/u,
    /(?:^|\s)egitimci(?:\s|$)/u,
    /egitim yonlendirmesi/u,
  ]);
}

export function inferKnowledgeSectionClassification(input: {
  title: string;
  content: string;
}): KnowledgeSectionClassification {
  const text = normalize(`${input.title} ${input.content}`);
  if (includesAny(text, [/(legacy|arsiv|oran tablosu|eski fiyat)/u])) return "archive";
  if (includesAny(text, [/(mesaj bankasi|bio bankasi|hediye bankasi|egitim materyali|grup botu|mesaj ornek|ilk mesaj.*uret|sayhi.*uret)/u])) return "training";
  if (includesAny(text, [/(coin|elmas|diamond|bonus orani|komisyon orani|kazanc tablosu)/u])) return "rate_sensitive";
  // Lifecycle training guidance is candidate-facing only after installation;
  // wording such as "sadece" must not turn it into an all-stage constraint.
  if (isPostInstallationTrainingTitle(input.title)) return "information";
  if (includesAny(text, [/(garanti|sifre|kart|iban|kimlik|18 yas|yas siniri|uygunluk|yasak)/u])) return "critical";
  if (includesAny(text, [/(kural|zorunlu|asla|sadece|reddet|eskalasyon|gizlilik|odeme|grup)/u])) return "constraint";
  return "information";
}

/**
 * Derives a bounded candidate-context scope from the approved section itself.
 * Constraints stay available everywhere; training banks and price tables never
 * become candidate context merely because they were materialized.
 */
export function inferKnowledgeSectionUsage(input: {
  title: string;
  content: string;
  classification?: KnowledgeSectionClassification | string;
}): KnowledgeSectionUsage {
  const classification = input.classification ?? "information";
  const text = normalize(`${input.title} ${input.content}`);

  if (classification === "archive" || classification === "training" || classification === "rate_sensitive") {
    return { candidate_context: false, stages: [], topic: classification };
  }
  if (isPostInstallationTrainingTitle(input.title)) {
    return { candidate_context: true, stages: ["training"], topic: "post_training_support" };
  }
  if (classification === "constraint" || classification === "critical") {
    return { candidate_context: true, stages: ALL_CANDIDATE_STAGES, topic: "safety_constraint" };
  }

  if (includesAny(text, [/(sayhi|aktiflik|mesaj gelmiyor|profil yenile|ilk mesaj|egitim sonrasi|egitim destek)/u])) {
    return { candidate_context: true, stages: ["training"], topic: "post_training_support" };
  }
  if (includesAny(text, [/(kurulum|davet|ajans kod|kontrol ekran|uye id|kullanici adi|uygulama magazasi|app store|play store)/u])) {
    return { candidate_context: true, stages: ["installation"], topic: "installation_support" };
  }
  if (includesAny(text, [/(yonlendirme|alternatif uygulama|uygulama sec|uygulama oner|cihaz|onceki uygulama)/u])) {
    return { candidate_context: true, stages: ["app_selection"], topic: "app_routing" };
  }
  if (includesAny(text, [/(yas|cinsiyet|gunluk sure|uygunluk|calisma modeli|profil|bio|fotograf)/u])) {
    return { candidate_context: true, stages: ["intake"], topic: "candidate_qualification" };
  }
  if (includesAny(text, [/(odeme|cekim|kazanc|iban|ayril|vazgec|destek|ban|teknik sorun)/u])) {
    return { candidate_context: true, stages: ALL_CANDIDATE_STAGES, topic: "operational_support" };
  }

  // A clear owner fact must not silently become dead knowledge. Unknown
  // operational information remains bounded by the global context budget.
  return { candidate_context: true, stages: ALL_CANDIDATE_STAGES, topic: "general_operational" };
}

export function normalizeKnowledgeUsage(
  value: unknown,
  fallback: Parameters<typeof inferKnowledgeSectionUsage>[0],
): KnowledgeSectionUsage {
  const inferred = inferKnowledgeSectionUsage(fallback);
  if (fallback.classification === "archive" || fallback.classification === "training" || fallback.classification === "rate_sensitive") {
    return inferred;
  }
  // Older records may have been classified before lifecycle scoping existed.
  // Recompute these so a generic constraint label cannot leak training text
  // into intake, routing, or installation context.
  if (inferred.topic === "post_training_support") return inferred;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return inferred;
  const record = value as Record<string, unknown>;
  const stages = Array.isArray(record.stages)
    ? record.stages.filter((stage): stage is CandidateKnowledgeStage => stage === "intake" || stage === "app_selection" || stage === "installation" || stage === "training")
    : inferred.stages;
  return {
    candidate_context: typeof record.candidate_context === "boolean" ? record.candidate_context : inferred.candidate_context,
    stages: [...new Set(stages)],
    topic: typeof record.topic === "string" && record.topic.trim() ? record.topic.trim() : inferred.topic,
  };
}
