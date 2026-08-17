import type { ConversationDecision, ConversationDecisionAction, ConversationDecisionContext } from "./ConversationDecisionSchema.js";

function normalize(value: string): string {
  return value.toLocaleLowerCase("tr-TR").normalize("NFKD").replace(/\p{M}/gu, "").replace(/ı/gu, "i");
}

const FALLBACK_REPEAT_MIN_CHARS = 40;
const FALLBACK_REPEAT_OVERLAP = 0.95;

function tokens(value: string): string[] {
  return normalize(value)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function tokenOverlap(a: string, b: string): number {
  const left = new Set(tokens(a));
  const right = new Set(tokens(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  return shared / Math.min(left.size, right.size);
}

function fallbackTopic(context: ConversationDecisionContext): string {
  const intent = context.latest_message.inferred_intent;
  const latest = normalize(context.latest_message.text);
  if (intent === "ask_job_definition" || intent === "ask_how_work_is_done") return "işin nasıl ilerlediği";
  if (/(uygulama|app|platform)/u.test(latest)) return "uygulama bilgisi";
  if (/(kazanc|kazan.|para|odeme|puan)/u.test(latest)) return "kazanç veya ödeme";
  if (/(kamera|hesap|profil|video|goruntulu)/u.test(latest)) return "kamera, hesap veya profil";
  if (intent === "clarify_previous_explanation") return "önceki açıklama";
  return "bu konu";
}

function publishedPolicySection(context: ConversationDecisionContext, key: string): string | null {
  const sections = context.structured_facts.policy_sections as Record<string, unknown> | null;
  const value = sections?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function hasPublishedFemaleProfileRule(context: ConversationDecisionContext): boolean {
  const text = normalize([
    publishedPolicySection(context, "profile_bio_photo_rules") ?? "",
    ...context.canonical_policy_facts.map((fact) => `${fact.fact} ${fact.content}`),
  ].join("\n"));
  return /(kadin|female)/u.test(text) && /(profil|foto|fotograf|photo)/u.test(text);
}

function recruiterPaymentReply(context: ConversationDecisionContext): string {
  const payment = context.structured_facts.general_work_model?.payment_policy?.trim();
  const support = publishedPolicySection(context, "privacy_payment_support");
  if (!payment && !support) {
    return "Bu odeme detayini netlestirip sana dogru bilgiyle donecegim.";
  }
  return [
    "Kazanc performansa, sohbet kalitesine, hediyelere ve uygulama performansina gore degisir.",
    payment
      ? "Cekim ve odeme adimlarini uygulama ekranindaki bilgilerle takip ederiz; odeme sureci genelde 1-3 is gunu bandinda ilerleyebilir."
      : null,
    support && /(iban|minimum|kesinti|hata|destek)/u.test(normalize(support))
      ? "Minimum, kesinti veya IBAN duzeltmesi gibi detaylari da uygulama ekranindan birlikte kontrol ederiz."
      : null,
  ].filter((part): part is string => Boolean(part)).join(" ");
}

function recruiterProfileReply(context: ConversationDecisionContext): string {
  const mentionsCamera = /(kamera|goruntulu|görüntülü|video)/u.test(normalize(context.latest_message.text));
  const femaleProfile = hasPublishedFemaleProfileRule(context)
    ? "Erkek adaylarda calisma kadin profili acilmasi ve uygun kadin fotograflari kullanilmasi uzerinden ilerler; bu model senin icin uygunsa acik onayinla devam ederiz."
    : "Profil adimlarini uygulamanin yayinli kurallarina gore birlikte netlestiririz.";
  const camera = mentionsCamera
    ? "Kamera veya goruntulu calisma zorunlu diye anlatmiyoruz; mesajlasma agirlikli ilerleyebilirsin."
    : "Profil ve fotograf adimlari calisma modelinin bir parcasi olarak net anlatilir.";
  return `${camera} ${femaleProfile}`;
}

function repeatsRecentAssistantReply(reply: string, context: ConversationDecisionContext): boolean {
  return context.recent_messages
    .filter((message) => message.role === "assistant")
    .some((message) => {
      const previous = normalize(message.text);
      const current = normalize(reply);
      return previous.length >= FALLBACK_REPEAT_MIN_CHARS
        && (current === previous || tokenOverlap(reply, message.text) >= FALLBACK_REPEAT_OVERLAP);
    });
}

function selectRepeatSafeFallbackReply(
  context: ConversationDecisionContext,
  baseReply: string,
  alternateReplies: string[],
): string {
  const candidates = [baseReply, ...alternateReplies];
  return candidates.find((reply) => !repeatsRecentAssistantReply(reply, context)) ?? candidates[candidates.length - 1];
}

function hasWorkQuestion(text: string): boolean {
  const normalized = normalize(text);
  return /(nasil|ne yapacagim|hesap|profil|is|calisma|reklam|bilgi|kamera|mesajlasma|anlamadim|kazanc|para|odeme|puan|garanti|kesin)/u.test(normalized);
}

function hasDisrespectfulCandidateTone(text: string): boolean {
  const normalized = normalize(text);
  const directTerms = ["ahraz", "cakal", "cakkal", "çakal", "çakkal", "salak", "aptal", "gerizekali", "mal", "embesil", "siktir", "amk", "aq", "orospu", "pic", "piç"];
  const tokenSet = new Set(tokens(normalized));
  if (directTerms.some((term) => tokenSet.has(term))) return true;
  return (
    /\b(ahraz|cakal|cakkal|çakal|çakkal|salak|aptal|gerizekali|gerizekalı|mal|embesil|siktir|amk|aq|orospu|pic|piç)\b/u.test(normalized) ||
    /\blan\b.{0,40}\b(cakal|cakkal|çakal|çakkal|salak|aptal|mal|ne anlatiyon|ne anlatÄ±yon|ne anlatiyorsun)\b/u.test(normalized) ||
    /\bne\s+anlatiyon\b/u.test(normalized)
  );
}

function baseDecision(reply: string, context: ConversationDecisionContext, origin: ConversationDecision["origin"]): ConversationDecision {
  const direct = hasWorkQuestion(context.latest_message.text);
  return {
    decision_version: "2.0",
    intent: {
      primary: context.latest_message.inferred_intent ?? (direct ? "ask_how_work_is_done" : "candidate_next_step"),
      secondary: [],
      confidence: 1
    },
    direct_question: {
      present: direct,
      question_summary: direct ? "Aday son mesajında açıklama veya netleştirme istiyor" : null,
      answered_in_reply: true
    },
    reply: {
      text: reply,
      language: "tr",
      tone: "natural_concise",
      contains_question: /\?/.test(reply)
    },
    chosen_actions: direct ? ["answer_user_question"] : ["clarify_ambiguous_input"],
    state_patch: {},
    policy_facts_used: [],
    next_action: "none",
    requires_escalation: origin !== "conversation_decision_v2_model",
    escalation_reason: origin === "deterministic_transport_failure" ? "model_transport_failure" : "conversation_decision_invalid",
    risk_flags: [],
    self_check: {
      answered_latest_message: true,
      asked_known_information_again: false,
      invented_policy: false,
      offered_setup_too_early: false,
      used_generic_closing: false
    },
    origin
  };
}

function approvedAppFromFacts(context: ConversationDecisionContext): string | null {
  const approved = context.structured_facts.app_facts
    .filter((fact) => normalize(fact.status).includes("owner_approved"));
  const structured = context.canonical_policy_facts.find((fact) => fact.id.startsWith("structured_app_job_definition_"));
  if (structured) {
    const match = structured.content.match(/Approved app:\s*([^.]+)\./i);
    if (match?.[1] && approved.some((fact) => normalize(fact.app) === normalize(match[1].trim()))) return match[1].trim();
  }
  const canonicalApp = context.canonical_policy_facts
    .map((fact) => fact.content)
    .map((content) => content.match(/Approved app:\s*([^.]+)\./i)?.[1]?.trim()
      ?? content.match(/\b([A-Z][A-Za-z0-9_-]+)\s*\/\s*[A-Z]/)?.[1])
    .find((value): value is string => Boolean(value));
  if (canonicalApp) return canonicalApp;
  return approved[0]?.app ?? null;
}

function approvedAppFacts(context: ConversationDecisionContext) {
  return context.structured_facts.app_facts
    .filter((fact) => normalize(fact.status).includes("owner_approved"));
}

function appFactFromLatestMessage(context: ConversationDecisionContext) {
  const latest = normalize(context.latest_message.text);
  return approvedAppFacts(context).find((fact) =>
    [fact.app, fact.android_name, fact.ios_name, ...fact.aliases]
      .some((value) => value && latest.includes(normalize(value)))
  ) ?? null;
}

function appFactFromLatestMessageOrState(context: ConversationDecisionContext) {
  return appFactFromLatestMessage(context)
    ?? approvedAppFacts(context).find((fact) =>
      context.candidate_state.selected_app !== null
      && normalize(fact.app) === normalize(context.candidate_state.selected_app)
    )
    ?? null;
}

function asksDownloadLink(text: string): boolean {
  return /(indir|indirme|link|url|nereden yukle|nereden yÃ¼kle|download)/u.test(normalize(text));
}

function asksInviteOrAgencyCode(text: string): boolean {
  return /(davet|invite|ajans|agency|kod|code)/u.test(normalize(text));
}

function asksAppCatalogOrRouting(text: string): boolean {
  return /(hangi uygulamalar|uygulamalar var|hangi app|hangi platform|hangi uygulama|uygulama oner|uygulama Ã¶ner|android.*uygun|iphone.*uygun|ios.*uygun)/u.test(normalize(text));
}

function asksInstallationQuestion(text: string): boolean {
  return /(kurulum|kuracagim|kuracaÄŸim|kurmam|devam edebilir|onay|ekran|davet kodu|ajans kodu)/u.test(normalize(text));
}

function hasAnyCanonicalPolicyFact(context: ConversationDecisionContext): boolean {
  return context.canonical_policy_facts.some((fact) => fact.content.trim().length > 0);
}

function missingFieldActions(context: ConversationDecisionContext): ConversationDecisionAction[] {
  const actions: ConversationDecisionAction[] = ["answer_user_question", "explain_work_model"];
  if (context.candidate_state.age === null) actions.push("ask_missing_age");
  if (context.candidate_state.gender === null) actions.push("ask_missing_gender");
  if (context.candidate_state.daily_hours === null) actions.push("ask_missing_daily_hours");
  if (actions.length === 2 && context.candidate_state.work_model_acceptance !== "accepted") {
    actions.push("request_work_model_acceptance");
  }
  return actions.filter((action, index, array) => array.indexOf(action) === index);
}

function nextActionFor(context: ConversationDecisionContext): ConversationDecision["next_action"] {
  if (context.candidate_state.age === null) return "ask_missing_age";
  if (context.candidate_state.gender === null) return "ask_missing_gender";
  if (context.candidate_state.daily_hours === null) return "ask_missing_daily_hours";
  if (context.candidate_state.work_model_acceptance !== "accepted") return "request_work_model_acceptance";
  return "none";
}

function buildJobDefinitionSafetyDecision(context: ConversationDecisionContext): ConversationDecision {
  const app = approvedAppFromFacts(context);
  const generalWorkModel = context.structured_facts.general_work_model;
  const latest = normalize(context.latest_message.text);
  const asksEarnings = /(kazanc|kazanç|para|odeme|ödeme|puan)/u.test(latest);
  const missing: string[] = [];
  if (context.candidate_state.age === null) missing.push("yaş");
  if (context.candidate_state.gender === null) missing.push("cinsiyet");
  if (context.candidate_state.daily_hours === null) missing.push("günlük ayırabileceğin süre");

  const appPart = app ? `${app} içinde ` : "Onaylı uygulama içinde ";
  const generalSummary = generalWorkModel?.summary ? `${generalWorkModel.summary} ` : "";
  const nextPart = missing.length > 0
    ? `Devam edebilmem için ${missing.join(", ")} bilgisini netleştirelim.`
    : "Bu çalışma modeli sana uygunsa kuruluma geçmeden önce bunu netleştirelim.";
  const earningsPart = asksEarnings
    ? "Kazanc performansa ve uygulama surecine gore degisir; odeme detayini netlestikce uygulama ekranindan birlikte kontrol ederiz. "
    : "";
  const reply =
    `${generalSummary || `İşin temel kısmı, ${appPart}gelen sohbet veya mesajlara yazıyla düzgün cevap vermek. `}` +
    "Kamera/görüntülü çalışma zorunlu diye bir kural söylemiyoruz; mesajlaşma ağırlıklı ilerleyebilirsin. " +
    earningsPart +
    nextPart;
  const groundedMissing: string[] = [];
  if (context.candidate_state.age === null) groundedMissing.push("yas");
  if (context.candidate_state.gender === null) groundedMissing.push("cinsiyet");
  if (context.candidate_state.daily_hours === null) groundedMissing.push("gunluk ayirabilecegin sure");
  const groundedNextPart = groundedMissing.length > 0
    ? `Devam edebilmem icin ${groundedMissing.join(", ")} bilgisini netlestirelim.`
    : "Bu calisma modeli sana uygunsa kuruluma gecmeden once bunu netlestirelim.";
  const groundedEarningsPart = asksEarnings
    ? "Kazanc performansa ve uygulama surecine gore degisir; odeme detayini netlestikce uygulama ekranindan birlikte kontrol ederiz. "
    : "";
  // Job-definition questions use the app-independent owner-approved summary as
  // the complete answer. Camera/text-only boundaries belong to app-specific
  // questions; appending them here made the fallback sound camera-first.
  const groundedReply = generalWorkModel?.summary?.trim()
    ? generalWorkModel.summary.trim()
    : `${app ? `${app} icinde ` : "onayli uygulama icinde "}gelen sohbet veya mesajlara yaziyla duzgun cevap vermek. ` +
      "Kamera/goruntulu calisma zorunlu diye bir kural soylemiyoruz; mesajlasma agirlikli ilerleyebilirsin. " +
      groundedEarningsPart +
      groundedNextPart;

  return {
    ...baseDecision(groundedReply, context, "deterministic_safety_response"),
    intent: { primary: "ask_job_definition", secondary: [], confidence: 1 },
    direct_question: {
      present: true,
      question_summary: "Aday işin ne olduğunu soruyor",
      answered_in_reply: true
    },
    chosen_actions: missingFieldActions(context),
    policy_facts_used: context.canonical_policy_facts.map((fact) => fact.id),
    next_action: nextActionFor(context),
    requires_escalation: false,
    escalation_reason: null
  };
}

function asksPaymentOrGuarantee(text: string): boolean {
  return /(kazanc|kazanÃ§|para|odeme|Ã¶deme|puan|garanti|kesin)/u.test(normalize(text));
}

function asksCameraAccountOrProfile(text: string): boolean {
  return /(kamera|goruntulu|gÃ¶rÃ¼ntÃ¼lÃ¼|video|hesap|hesabi|hesabÄ±|profil)/u.test(normalize(text));
}

function buildPaymentBoundarySafetyDecision(context: ConversationDecisionContext): ConversationDecision {
  const policy = publishedPolicySection(context, "privacy_payment_support")
    ?? context.structured_facts.general_work_model?.payment_policy?.trim()
    ?? null;
  const reply = recruiterPaymentReply(context);
  return {
    ...baseDecision(reply, context, "deterministic_safety_response"),
    intent: { primary: "payment_question", secondary: [], confidence: 1 },
    direct_question: {
      present: true,
      question_summary: "Aday kazanc veya odeme guvencesi soruyor",
      answered_in_reply: true,
    },
    chosen_actions: ["answer_user_question"],
    policy_facts_used: context.canonical_policy_facts.map((fact) => fact.id),
    next_action: "none",
    requires_escalation: policy === null,
    escalation_reason: policy === null ? "payment_policy_missing" : null,
  };
}

function buildCameraAccountBoundarySafetyDecision(context: ConversationDecisionContext): ConversationDecision {
  const reply = recruiterProfileReply(context);
  return {
    ...baseDecision(reply, context, "deterministic_safety_response"),
    intent: { primary: "account_profile_question", secondary: [], confidence: 1 },
    direct_question: {
      present: true,
      question_summary: "Aday kamera, hesap veya profil zorunlulugunu soruyor",
      answered_in_reply: true,
    },
    chosen_actions: ["answer_user_question"],
    policy_facts_used: context.canonical_policy_facts.map((fact) => fact.id),
    next_action: "none",
    requires_escalation: false,
    escalation_reason: null,
  };
}

function buildAppCatalogSafetyDecision(context: ConversationDecisionContext): ConversationDecision | null {
  if (!asksAppCatalogOrRouting(context.latest_message.text)) return null;
  const facts = approvedAppFacts(context);
  const routing = publishedPolicySection(context, "routing_matrix");
  if (facts.length === 0 && !routing) return null;
  const appList = facts.map((fact) => fact.app).join(", ");
  const reply = routing
    ? `${routing} Onayli uygulamalar: ${appList || "yayinda onayli uygulama listesi bulunmuyor"}.`
    : `Onayli uygulamalar: ${appList}. Uygulamayi cihaz ve uygunluk bilgilerine gore netlestiririz.`;
  return {
    ...baseDecision(reply, context, "deterministic_safety_response"),
    intent: { primary: "app_selection_question", secondary: [], confidence: 1 },
    direct_question: {
      present: true,
      question_summary: "Aday onayli uygulama veya yonlendirme bilgisini soruyor",
      answered_in_reply: true,
    },
    chosen_actions: ["answer_user_question"],
    policy_facts_used: context.canonical_policy_facts.map((fact) => fact.id),
    next_action: "none",
    requires_escalation: false,
    escalation_reason: null,
  };
}

function buildKnownAppLinkSafetyDecision(context: ConversationDecisionContext): ConversationDecision | null {
  if (!asksDownloadLink(context.latest_message.text)) return null;
  const fact = appFactFromLatestMessageOrState(context);
  if (!fact?.official_url?.trim()) return null;
  const reply = `${fact.app} icin yayinli kurulum linki: ${fact.official_url.trim()}. Bu linkle ilerleyelim.`;
  return {
    ...baseDecision(reply, context, "deterministic_safety_response"),
    intent: { primary: "app_fact_question", secondary: ["download_link"], confidence: 1 },
    direct_question: {
      present: true,
      question_summary: "Aday onayli uygulama indirme linkini soruyor",
      answered_in_reply: true,
    },
    chosen_actions: ["answer_user_question"],
    policy_facts_used: context.canonical_policy_facts.map((fact) => fact.id),
    next_action: "none",
    requires_escalation: false,
    escalation_reason: null,
  };
}

export function buildMissingStructuredAppFieldDecision(context: ConversationDecisionContext): ConversationDecision | null {
  const asksLink = asksDownloadLink(context.latest_message.text);
  const asksCode = asksInviteOrAgencyCode(context.latest_message.text);
  if (!asksLink && !asksCode) return null;

  const fact = appFactFromLatestMessageOrState(context);
  if (!fact) return null;

  const missingFields: string[] = [];
  if (asksLink && !fact.official_url?.trim()) missingFields.push("official_url");
  if (asksCode && !fact.invite_code?.trim() && !fact.agency_bind_code?.trim() && !fact.agency_code?.trim()) {
    missingFields.push("invite_code");
  }
  if (missingFields.length === 0) return null;

  const fieldText = missingFields.includes("official_url")
    ? "indirme linki"
    : "davet/ajans kodu";
  const reply =
    `${fact.app} icin ${fieldText} henuz yayinli bilgi bankasinda net degil. ` +
    "Bunu kontrol listesine aliyorum; netlesince sana dogru bilgiyle donecegim.";

  return {
    ...baseDecision(reply, context, "deterministic_safety_response"),
    intent: { primary: "app_fact_question", secondary: missingFields, confidence: 1 },
    direct_question: {
      present: true,
      question_summary: `Aday ${fact.app} icin eksik dogrulanmis alan soruyor`,
      answered_in_reply: true,
    },
    chosen_actions: ["answer_user_question"],
    policy_facts_used: context.canonical_policy_facts.map((policyFact) => policyFact.id),
    next_action: "escalate_missing_info",
    requires_escalation: true,
    escalation_reason: "structured_app_field_missing",
    risk_flags: ["structured_app_field_missing"],
    self_check: {
      answered_latest_message: true,
      asked_known_information_again: false,
      invented_policy: false,
      offered_setup_too_early: false,
      used_generic_closing: false,
    },
  };
}

function buildInstallationSafetyDecision(context: ConversationDecisionContext): ConversationDecision | null {
  if (!asksInstallationQuestion(context.latest_message.text)) return null;
  const installationProcess = publishedPolicySection(context, "installation_process");
  const installationPermission = publishedPolicySection(context, "installation_permission");
  const installationProofRetry = publishedPolicySection(context, "installation_proof_retry");
  const appFact = appFactFromLatestMessage(context)
    ?? approvedAppFacts(context).find((fact) => context.candidate_state.selected_app && normalize(fact.app) === normalize(context.candidate_state.selected_app))
    ?? null;
  if (!installationProcess && !installationPermission && !installationProofRetry && !appFact) return null;
  const parts = [
    installationProcess,
    installationPermission,
    installationProofRetry,
    appFact ? `Secili uygulama bilgisi: ${appFact.app}; davet kodu ${appFact.invite_code ?? "yayinda degil"}; ajans kodu ${appFact.agency_code ?? appFact.agency_bind_code ?? "yayinda degil"}.` : null,
  ].filter((part): part is string => Boolean(part && part.trim()));
  const reply = `${parts.join(" ")} Kurulumda bu bilgilerle adim adim ilerleyelim.`;
  return {
    ...baseDecision(reply, context, "deterministic_safety_response"),
    intent: { primary: "installation_question", secondary: [], confidence: 1 },
    direct_question: {
      present: true,
      question_summary: "Aday kurulum veya onay adimini soruyor",
      answered_in_reply: true,
    },
    chosen_actions: ["answer_user_question"],
    policy_facts_used: context.canonical_policy_facts.map((fact) => fact.id),
    next_action: "none",
    requires_escalation: false,
    escalation_reason: null,
  };
}

function selectedOrRecommendedAppFact(context: ConversationDecisionContext) {
  const selected = appFactFromLatestMessageOrState(context);
  if (selected) return selected;
  const facts = approvedAppFacts(context);
  return facts.find((fact) => fact.official_url?.trim() && (fact.invite_code?.trim() || fact.agency_code?.trim() || fact.agency_bind_code?.trim()))
    ?? facts[0]
    ?? null;
}

function installationInstructionReply(context: ConversationDecisionContext, fact: ReturnType<typeof selectedOrRecommendedAppFact>): ConversationDecision | null {
  if (!fact) return null;
  if (!fact.official_url?.trim()) {
    return {
      ...baseDecision(
        `${fact.app} icin indirme linki henuz yayinli bilgi bankasinda net degil. Bunu kontrol listesine aliyorum; netlesince sana dogru bilgiyle donecegim.`,
        context,
        "deterministic_safety_response",
      ),
      intent: { primary: "app_fact_question", secondary: ["official_url"], confidence: 1 },
      direct_question: { present: false, question_summary: null, answered_in_reply: true },
      chosen_actions: ["answer_user_question"],
      policy_facts_used: context.canonical_policy_facts.map((policyFact) => policyFact.id),
      next_action: "escalate_missing_info",
      requires_escalation: true,
      escalation_reason: "structured_app_field_missing",
      risk_flags: ["structured_app_field_missing"],
    };
  }
  const code = fact.invite_code?.trim() ?? fact.agency_bind_code?.trim() ?? fact.agency_code?.trim() ?? null;
  if (!code) {
    return {
      ...baseDecision(
        `${fact.app} icin davet/ajans kodu henuz yayinli bilgi bankasinda net degil. Bunu kontrol listesine aliyorum; netlesince sana dogru bilgiyle donecegim.`,
        context,
        "deterministic_safety_response",
      ),
      intent: { primary: "installation_question", secondary: ["invite_code"], confidence: 1 },
      direct_question: { present: false, question_summary: null, answered_in_reply: true },
      chosen_actions: ["answer_user_question"],
      policy_facts_used: context.canonical_policy_facts.map((policyFact) => policyFact.id),
      next_action: "escalate_missing_info",
      requires_escalation: true,
      escalation_reason: "structured_app_field_missing",
      risk_flags: ["structured_app_field_missing"],
    };
  }

  const phoneLabel = context.candidate_state.phone_type === "ios" ? "iPhone" : "Android";
  const reply =
    `${phoneLabel} icin ${fact.app} kurulum linki: ${fact.official_url.trim()}\n\n` +
    `Kayittan sonra Ben > Ajans > Ajansa Katil bolumune ${code} kodunu gir. ` +
    "Ardindan profilini tamamlayip kullanici adi, Uye ID ve Ajans ekranini gosteren net gorseli gonder.";
  return {
    ...baseDecision(reply, context, "deterministic_safety_response"),
    intent: { primary: "installation_question", secondary: ["known_facts_complete"], confidence: 1 },
    direct_question: { present: false, question_summary: null, answered_in_reply: true },
    reply: { text: reply, language: "tr", tone: "natural_concise", contains_question: false },
    chosen_actions: ["answer_user_question", "provide_installation_instruction"],
    policy_facts_used: context.canonical_policy_facts.map((policyFact) => policyFact.id),
    next_action: "begin_setup",
    requires_escalation: false,
    escalation_reason: null,
  };
}

export function buildCapturedAppOrPhoneProgressDecision(
  context: ConversationDecisionContext,
  capturedFields: string[],
): ConversationDecision | null {
  if (context.role !== "candidate" || context.channel !== "private") return null;
  const appCaptured = capturedFields.includes("selected_app");
  const phoneCaptured = capturedFields.includes("phone_type");
  if (!appCaptured && !phoneCaptured) return null;
  if (context.candidate_state.work_model_acceptance !== "accepted") return null;

  const missingApp = context.candidate_state.selected_app === null;
  const missingPhone = context.candidate_state.phone_type === null;

  if (!missingApp && !missingPhone) {
    return installationInstructionReply(context, selectedOrRecommendedAppFact(context));
  }

  if (!missingApp && missingPhone) {
    const reply = `${context.candidate_state.selected_app} bilgisini aldim. Kurulum icin telefonun Android mi iPhone mu?`;
    return {
      ...baseDecision(reply, context, "deterministic_safety_response"),
      intent: { primary: "candidate_next_step", secondary: ["selected_app_captured"], confidence: 1 },
      direct_question: { present: false, question_summary: null, answered_in_reply: true },
      reply: { text: reply, language: "tr", tone: "natural_concise", contains_question: true },
      chosen_actions: ["answer_user_question", "acknowledge_information", "ask_phone_type"],
      policy_facts_used: context.canonical_policy_facts.map((policyFact) => policyFact.id),
      next_action: "ask_phone_type",
      requires_escalation: false,
      escalation_reason: null,
    };
  }

  if (missingApp && !missingPhone) {
    const fact = selectedOrRecommendedAppFact(context);
    if (!fact) return null;
    const phoneLabel = context.candidate_state.phone_type === "ios" ? "iPhone" : "Android";
    const reply =
      `${phoneLabel} bilgisini aldim. Onayli uygulama olarak ${fact.app} ile ilerleyelim. ${fact.app} ile devam edelim mi?`;
    return {
      ...baseDecision(reply, context, "deterministic_safety_response"),
      intent: { primary: "candidate_next_step", secondary: ["app_recommendation"], confidence: 1 },
      direct_question: { present: false, question_summary: null, answered_in_reply: true },
      reply: { text: reply, language: "tr", tone: "natural_concise", contains_question: true },
      chosen_actions: ["answer_user_question", "acknowledge_information"],
      policy_facts_used: context.canonical_policy_facts.map((policyFact) => policyFact.id),
      next_action: "reply_only",
      requires_escalation: false,
      escalation_reason: null,
    };
  }

  return null;
}

function buildGroundedSafetyDecision(context: ConversationDecisionContext): ConversationDecision | null {
  if (asksPaymentOrGuarantee(context.latest_message.text)) return buildPaymentBoundarySafetyDecision(context);
  if (asksCameraAccountOrProfile(context.latest_message.text)) return buildCameraAccountBoundarySafetyDecision(context);
  const missingStructuredField = buildMissingStructuredAppFieldDecision(context);
  if (missingStructuredField) return missingStructuredField;
  const link = buildKnownAppLinkSafetyDecision(context);
  if (link) return link;
  const appCatalog = buildAppCatalogSafetyDecision(context);
  if (appCatalog) return appCatalog;
  const installation = buildInstallationSafetyDecision(context);
  if (installation) return installation;
  if (
    context.latest_message.inferred_intent === "ask_job_definition"
    || context.latest_message.inferred_intent === "ask_how_work_is_done"
    || /(reklam|daha fazla bilgi|calisma|is.*bilgi|iÅŸ.*bilgi)/u.test(normalize(context.latest_message.text))
  ) {
    if (context.structured_facts.general_work_model || hasAnyCanonicalPolicyFact(context)) {
      return buildJobDefinitionSafetyDecision(context);
    }
  }
  return null;
}

function shouldEscalateMissingVerifiedDetail(context: ConversationDecisionContext, reason: "invalid_model_decision" | "provider_unavailable" | "policy_missing"): boolean {
  if (reason === "policy_missing" || !hasAnyCanonicalPolicyFact(context)) return true;
  if (asksDownloadLink(context.latest_message.text)) {
    const fact = appFactFromLatestMessageOrState(context);
    return Boolean(fact && !fact.official_url?.trim());
  }
  return false;
}

export function buildCapturedModelAcceptanceDecision(context: ConversationDecisionContext): ConversationDecision | null {
  if (context.role !== "candidate" || context.channel !== "private") return null;
  if (!context.facts_extracted_from_current_message.includes("model_acceptance")) return null;
  if (context.candidate_state.work_model_acceptance !== "accepted") return null;

  const missingApp = context.candidate_state.selected_app === null;
  const missingPhone = context.candidate_state.phone_type === null;
  const selectedApp = context.candidate_state.selected_app;
  const phoneType = context.candidate_state.phone_type;

  let reply = "Calisma modelini kabul ettigini aldim.";
  const requestedActions: ConversationDecisionAction[] = ["acknowledge_information"];
  let nextAction: ConversationDecision["next_action"] = "none";
  let containsQuestion = false;
  let requiresEscalation = false;
  let escalationReason: string | null = null;
  let riskFlags: string[] = [];

  if (missingApp && missingPhone) {
    reply += " Simdi telefon tipini netlestirelim: Android mi iPhone mu? Telefon bilgisinden sonra onayli uygulamayi ben net yonlendirecegim.";
    requestedActions.push("ask_phone_type");
    nextAction = "ask_phone_type";
    containsQuestion = true;
  } else if (missingApp) {
    const fact = selectedOrRecommendedAppFact(context);
    if (fact) {
      reply += ` Onayli uygulama olarak ${fact.app} ile ilerleyelim. ${fact.app} ile devam edelim mi?`;
      nextAction = "reply_only";
      containsQuestion = true;
    } else {
      reply += " Onayli uygulama listesi su an contextte yok; owner kontrolune aliyorum.";
      nextAction = "escalate_missing_info";
      requiresEscalation = true;
      escalationReason = "structured_app_field_missing";
      riskFlags = ["structured_app_field_missing"];
    }
  } else if (missingPhone) {
    reply += ` ${selectedApp ?? "Secili uygulama"} icin devam edebiliriz; telefonun Android mi iPhone mu?`;
    requestedActions.push("ask_phone_type");
    nextAction = "ask_phone_type";
    containsQuestion = true;
  } else {
    reply += ` ${selectedApp ?? "Secili uygulama"} ve ${phoneType ?? "telefon"} bilgisi de kayitli; kurulum adimina gecebiliriz.`;
    requestedActions.push("provide_installation_instruction");
    nextAction = "begin_setup";
  }

  const allowed = new Set(context.allowed_actions);
  const chosenActions = requestedActions.filter((action) => allowed.has(action));
  if (!chosenActions.includes("answer_user_question")) chosenActions.unshift("answer_user_question");

  return {
    ...baseDecision(reply, context, "deterministic_safety_response"),
    intent: { primary: "candidate_next_step", secondary: ["model_acceptance_captured"], confidence: 1 },
    direct_question: {
      present: false,
      question_summary: null,
      answered_in_reply: true,
    },
    reply: {
      text: reply,
      language: "tr",
      tone: "natural_concise",
      contains_question: containsQuestion,
    },
    chosen_actions: [...new Set(chosenActions)],
    state_patch: {},
    policy_facts_used: context.canonical_policy_facts.map((fact) => fact.id),
    next_action: nextAction,
    requires_escalation: requiresEscalation,
    escalation_reason: escalationReason,
    risk_flags: riskFlags,
  };
}

export function requiresFemaleProfileRule(context: ConversationDecisionContext): boolean {
  if (normalize(context.candidate_state.gender ?? "") !== "erkek") return false;
  if (!context.derived_state.intake_complete) return false;
  if (context.candidate_state.work_model_acceptance === "accepted") return false;
  if (["candidate_boundary_tone", "off_topic", "greeting_or_first_contact"].includes(context.latest_message.inferred_intent ?? "")) return false;
  if (context.latest_message.inferred_intent === "clarify_previous_explanation") return false;
  const latest = normalize(context.latest_message.text);
  if (/(odeme|para|puan|kazanc|garanti|link|indir|download|davet|ajans|kod|kurulum|telefon|android|iphone|uygulama|app)/u.test(latest)) {
    return false;
  }
  const workModelContext =
    context.derived_state.dialogue_phase === "WORK_MODEL_DISCLOSURE"
    || context.derived_state.dialogue_phase === "WORK_MODEL_ACCEPTANCE"
    || context.latest_message.inferred_intent === "ask_job_definition"
    || context.latest_message.inferred_intent === "ask_how_work_is_done"
    || context.facts_extracted_from_current_message.some((field) => field === "age" || field === "gender" || field === "daily_hours");
  if (!workModelContext) return false;
  const factText = normalize([
    ...context.canonical_policy_facts.map((fact) => `${fact.fact} ${fact.content}`),
    context.structured_facts.policy_sections?.profile_bio_photo_rules ?? "",
  ].join("\n"));
  return /(kadin|female)/u.test(factText) && /(profil|foto|fotograf|photo)/u.test(factText);
}

export function replyMentionsFemaleProfileRule(reply: string): boolean {
  const text = normalize(reply).replace(/\u0131/gu, "i").replace(/\u0130/gu, "i");
  const hasFemaleProfile = /(kadin|female).{0,80}(profil|foto|fotograf|photo)|(profil|foto|fotograf|photo).{0,80}(kadin|female)/u.test(text);
  if (!hasFemaleProfile) return false;
  const defersRule = /(ayrica|sonra|daha sonra|ileride).{0,60}(anlat|netles|acikla)|acik onayla anlatilir/u.test(text);
  if (defersRule) return false;
  return /(kadin|female).{0,100}(profil|foto|fotograf|photo).{0,100}(acilir|acilmasi|kullanilir|kullanilmasi|olusturulur|olusturulmasi)|(profil|foto|fotograf|photo).{0,100}(kadin|female).{0,100}(acilir|acilmasi|kullanilir|kullanilmasi|olusturulur|olusturulmasi)/u.test(text);
}

function removeDeferredFemaleProfileRule(reply: string): string {
  const parts = reply.split(/(?<=[.!?])\s+/u);
  const filtered = parts.filter((part) => {
    const text = normalize(part).replace(/\u0131/gu, "i").replace(/\u0130/gu, "i");
    const mentionsFemaleProfile = /(kadin|female).{0,100}(profil|foto|fotograf|photo)|(profil|foto|fotograf|photo).{0,100}(kadin|female)/u.test(text);
    const defersRule = /(ayrica|sonra|daha sonra|ileride).{0,80}(anlat|netles|acikla)|acik onayla anlatilir/u.test(text);
    return !(mentionsFemaleProfile && defersRule);
  });
  return (filtered.join(" ").trim() || reply.trim()).replace(/\s+/g, " ");
}

export function completeDecisionWithRequiredProfileRule(
  decision: ConversationDecision,
  context: ConversationDecisionContext,
): { decision: ConversationDecision; applied: boolean; reason_codes: string[] } {
  const explainsWorkModel =
    decision.chosen_actions.includes("explain_work_model")
    || decision.chosen_actions.includes("request_work_model_acceptance")
    || decision.intent.primary === "ask_job_definition"
    || decision.intent.primary === "ask_how_work_is_done";
  if (!explainsWorkModel || ["candidate_boundary_tone", "off_topic", "greeting_or_first_contact"].includes(decision.intent.primary)) {
    return { decision, applied: false, reason_codes: [] };
  }
  if (!requiresFemaleProfileRule(context) || replyMentionsFemaleProfileRule(decision.reply.text)) {
    return { decision, applied: false, reason_codes: [] };
  }

  const completion =
    " Erkek adaylarda calisma kadin profili acilmasi ve kadin fotograflari kullanilmasi uzerinden ilerler; bu model senin icin uygunsa acik onayinla devam ederiz.";

  return {
    decision: {
      ...decision,
      reply: {
        ...decision.reply,
        text: `${removeDeferredFemaleProfileRule(decision.reply.text)}${completion}`,
      },
      policy_facts_used: [...new Set([
        ...decision.policy_facts_used,
        ...context.canonical_policy_facts
          .map((fact) => fact.id)
          .filter((id) => id.includes("profile") || id.includes("work_model") || id.includes("male")),
      ])],
      self_check: {
        ...decision.self_check,
        invented_policy: false,
      },
    },
    applied: true,
    reason_codes: ["REQUIRED_PROFILE_RULE_OMITTED"],
  };
}

export function buildOffTopicSafetyDecision(context: ConversationDecisionContext): ConversationDecision {
  const reply = "Bu konu is veya kurulum tarafina girmiyor; isleyis, uygulama ya da kurulum adimlarinda yardimci olayim.";
  return {
    ...baseDecision(reply, context, "deterministic_safety_response"),
    intent: { primary: "off_topic", secondary: [], confidence: 1 },
    direct_question: {
      present: true,
      question_summary: "Kapsam disi bir soru",
      answered_in_reply: true,
    },
    chosen_actions: ["respond_to_off_topic_question"],
    policy_facts_used: [],
    next_action: "none",
    requires_escalation: false,
    escalation_reason: null,
  };
}

export function buildPartialIntakeSafetyDecision(context: ConversationDecisionContext): ConversationDecision | null {
  if (context.role !== "candidate" || context.channel !== "private") return null;
  if (context.facts_extracted_from_current_message.length === 0) return null;

  const missing: Array<{ action: ConversationDecisionAction; label: string }> = [];
  if (context.candidate_state.age === null) missing.push({ action: "ask_missing_age", label: "yasini" });
  if (context.candidate_state.gender === null) missing.push({ action: "ask_missing_gender", label: "cinsiyetini" });
  if (context.candidate_state.daily_hours === null) {
    missing.push({ action: "ask_missing_daily_hours", label: "gunluk ayirabilecegin sureyi" });
  }
  if (missing.length === 0) return null;

  const capturedLabels = context.facts_extracted_from_current_message
    .map((field) => ({ age: "yas", gender: "cinsiyet", daily_hours: "gunluk sure" }[field] ?? field))
    .join(", ");
  const missingLabels = missing.map((item) => item.label).join(" ve ");
  const reply = `${capturedLabels} bilgisini aldim. Simdi ${missingLabels} yazar misin?`;
  return {
    ...baseDecision(reply, context, "deterministic_safety_response"),
    intent: { primary: "candidate_next_step", secondary: ["partial_intake"], confidence: 1 },
    direct_question: {
      present: false,
      question_summary: "Adayin tek veya kismi intake bilgisi verdi",
      answered_in_reply: true,
    },
    chosen_actions: ["answer_user_question", ...missing.map((item) => item.action)],
    policy_facts_used: [],
    next_action: missing[0]?.action ?? "ask_missing_age",
    requires_escalation: false,
    escalation_reason: null,
  };
}

export function buildCandidateToneBoundaryDecision(context: ConversationDecisionContext): ConversationDecision | null {
  if (context.role !== "candidate" || context.channel !== "private") return null;
  if (!hasDisrespectfulCandidateTone(context.latest_message.text)) return null;

  const reply =
    "Sana yardimci olurum ama bu sekilde konusmayalim. Calisma modeli veya sorununu net yazarsan isi ve sonraki adimi kisa, dogru sekilde anlatirim.";

  return {
    ...baseDecision(reply, context, "deterministic_safety_response"),
    intent: { primary: "candidate_boundary_tone", secondary: [], confidence: 1 },
    direct_question: {
      present: false,
      question_summary: null,
      answered_in_reply: true,
    },
    chosen_actions: ["handle_user_frustration", "explain_work_model"],
    policy_facts_used: context.canonical_policy_facts.map((fact) => fact.id),
    next_action: "none",
    requires_escalation: false,
    escalation_reason: null,
  };
}

export function buildDeterministicSafetyDecision(
  context: ConversationDecisionContext,
  reason: "invalid_model_decision" | "provider_unavailable" | "policy_missing"
): ConversationDecision {
  const groundedDecision = buildGroundedSafetyDecision(context);
  if (groundedDecision) return groundedDecision;

  if (reason === "invalid_model_decision" && asksPaymentOrGuarantee(context.latest_message.text)) {
    return buildPaymentBoundarySafetyDecision(context);
  }

  if (reason === "invalid_model_decision" && asksCameraAccountOrProfile(context.latest_message.text)) {
    return buildCameraAccountBoundarySafetyDecision(context);
  }

  if ((reason === "invalid_model_decision" || reason === "provider_unavailable") && context.latest_message.inferred_intent === "off_topic") {
    return buildOffTopicSafetyDecision(context);
  }

  if (reason === "invalid_model_decision" || reason === "provider_unavailable") {
    const partialIntakeDecision = buildPartialIntakeSafetyDecision(context);
    if (partialIntakeDecision) return partialIntakeDecision;
  }

  if (reason === "invalid_model_decision" && context.latest_message.inferred_intent === "ask_job_definition") {
    return buildJobDefinitionSafetyDecision(context);
  }

  const reply = selectRepeatSafeFallbackReply(context,
    "Bunu hemen kontrol ediyorum; birkaç dakika içinde döneceğim.",
    [
      "Bunu kontrol ediyorum; kısa süre içinde dönüş yapacağım.",
      "Sorunu aldım, doğrulayıp kısa süre içinde yanıtlayacağım."
    ]);
  const escalate = shouldEscalateMissingVerifiedDetail(context, reason);
  return {
    ...baseDecision(
      reply,
      context,
      reason === "provider_unavailable" ? "deterministic_transport_failure" : "deterministic_safety_response"
    ),
    requires_escalation: escalate,
    escalation_reason: escalate ? "conversational_escalation_claim" : null
  };
}
