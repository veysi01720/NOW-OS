import type { UserState } from "../../storage/types.js";
import type { StructuredAppFact, StructuredGeneralWorkModel } from "../../bridge/structuredAppFacts.js";
import type { StructuredPolicySections } from "../../contracts/backendContextPayload.js";
import type { ConversationPolicyFact } from "../conversation/ConversationDecisionSchema.js";

export type CandidatePolicyStage = "intake" | "app_selection" | "installation" | "training";

export interface CandidatePolicyResolution {
  facts: ConversationPolicyFact[];
  policyMissing: boolean;
  secondary_apps: string[];
  stage: CandidatePolicyStage;
  policy_section_ids: string[];
  policy_context_token_estimate: number;
  missing_stage_sections: string[];
}

const STAGE_POLICY_SECTIONS: Record<CandidatePolicyStage, Array<keyof StructuredPolicySections>> = {
  intake: ["first_contact_boundary", "source_identity_tone", "eligibility_rejection", "profile_bio_photo_rules", "memory_rules"],
  app_selection: ["routing_matrix", "application_independence", "profile_bio_photo_rules", "memory_rules", "source_identity_tone"],
  installation: ["installation_process", "installation_permission", "installation_proof_retry", "application_independence", "profile_bio_photo_rules", "memory_rules", "source_identity_tone"],
  training: ["owner_training_routing", "application_independence", "memory_rules", "source_identity_tone"],
};

const ALWAYS_REQUIRED_CONSTRAINT_SECTIONS: Array<keyof StructuredPolicySections> = [
  "eligibility_rejection",
  "privacy_payment_support",
];

function normalize(value: string): string {
  return value.toLocaleLowerCase("tr-TR").normalize("NFKD").replace(/\p{M}/gu, "").replace(/Ä±/gu, "i");
}

function resolvePolicyStage(state: UserState): CandidatePolicyStage {
  if (["TRAINING_READY", "TRAINING_IN_PROGRESS", "TRAINING_DONE"].includes(state.current_state)) return "training";
  if (
    ["READY_FOR_INSTALLATION", "INSTALLATION_IN_PROGRESS", "INSTALLATION_DONE"].includes(state.current_state)
    || state.installation_status === "in_progress"
    || state.installation_status === "done"
  ) return "installation";
  if (["WAITING_FOR_APP", "WAITING_FOR_PHONE_TYPE"].includes(state.current_state) || state.selected_app !== null) return "app_selection";
  return "intake";
}

function appMatches(value: string | null | undefined, fact: StructuredAppFact): boolean {
  if (!value) return false;
  const target = normalize(value);
  return [fact.app, fact.android_name, fact.ios_name, ...fact.aliases].some((candidate) => normalize(candidate) === target);
}

function selectStructuredFact(state: UserState, structuredFacts: StructuredAppFact[]): StructuredAppFact | null {
  const ownerApproved = structuredFacts.filter((fact) => normalize(fact.status).includes("owner_approved"));
  if (ownerApproved.length === 0) return null;
  return ownerApproved.find((fact) => appMatches(state.selected_app, fact)) ?? null;
}

function structuredJobDefinitionFact(fact: StructuredAppFact): ConversationPolicyFact {
  const display = fact.app === fact.ios_name ? fact.app : `${fact.app} (iPhone: ${fact.ios_name})`;
  const boundary = fact.capabilities.text_only
    ? "Text/chat-oriented work is supported; do not present camera or video as required."
    : "No text-only guarantee is encoded for this app; do not invent camera, account, or profile requirements.";
  const invitePart = fact.invite_code ? ` Approved invite code: ${fact.invite_code}.` : "";
  const content = `Approved app: ${display}. Job definition: the candidate answers incoming chats/messages in writing inside the approved app. ${boundary}${invitePart} Do not invent earnings, setup links, account ownership, or hidden platform behavior.`;
  return { id: `structured_app_job_definition_${normalize(fact.app).replace(/[^a-z0-9]+/gu, "_")}`, topic: "candidate_work_model", fact: content, content, source: "knowledge_bank", version: "app_facts_structured.json" };
}

function structuredAppFactForStage(fact: StructuredAppFact, stage: CandidatePolicyStage): ConversationPolicyFact {
  const details = [
    `Approved application: ${fact.app}.`,
    `Android display name: ${fact.android_name}.`,
    `iOS display name: ${fact.ios_name}.`,
    fact.official_url ? `Official download link: ${fact.official_url}.` : "Official download link: not published.",
    fact.invite_code ? `Invite code: ${fact.invite_code}.` : "Invite code: not published.",
    fact.agency_bind_code ? `Agency bind code: ${fact.agency_bind_code}.` : "Agency bind code: not published.",
    fact.agency_code ? `Agency code: ${fact.agency_code}.` : "Agency code: not published.",
    `Text-only capability: ${fact.capabilities.text_only ? "yes" : "not marked"}.`,
  ].join(" ");
  const content = stage === "installation"
    ? `${details} Use only these published values during installation; do not invent a link, code, account, or control-screen step.`
    : `Published application option: ${fact.app}; Android=${fact.android_name}; iOS=${fact.ios_name}; text-only=${fact.capabilities.text_only ? "yes" : "not marked"}. Do not ask which application the candidate was sent to.`;
  return {
    id: `structured_app_fact_${normalize(fact.app).replace(/[^a-z0-9]+/gu, "_")}`,
    topic: stage === "installation" ? "installation_application_facts" : "candidate_app_options",
    fact: content,
    content,
    source: "knowledge_bank",
    version: "app_facts_structured.json",
  };
}

export interface OwnerTransferPolicySection {
  section_id: string;
  title: string;
  content: string;
  classification?: "information" | "constraint" | "critical" | "archive";
}

function structuredPolicySectionFact(key: keyof StructuredPolicySections, content: string): ConversationPolicyFact {
  return { id: `policy_section_${key}`, topic: key, fact: content, content, source: "knowledge_bank", version: "app_facts_structured.json" };
}

function prepareRoutingSection(content: string, stage: CandidatePolicyStage): string {
  if (stage !== "app_selection") return content;
  return content
    .split("\n")
    .filter((line) => !/kurulum\s+sonrasi|onceki\s+uygulamalar/u.test(normalize(line)))
    .concat("- Adaya uygulama secmesini sorma; cihaz, tercih ve uygunluk bilgilerine gore onayli listeden tek bir uygun uygulama oner.")
    .join("\n");
}

function ownerTransferMatchesStage(section: OwnerTransferPolicySection, stage: CandidatePolicyStage): boolean {
  if (section.classification === "archive") return false;
  if (section.classification === "constraint" || section.classification === "critical") return true;
  const text = normalize(`${section.title} ${section.content}`);
  if (/(odeme|cekim|kazanc|iban|ucret|ayril|vazgec|ara ver)/u.test(text)) return true;
  if (stage === "intake") return /(yas|cinsiyet|uygun|profil|bio|foto|fotograf|is model|calisma)/u.test(text);
  if (stage === "app_selection") return /(uygulama|alternatif|yonlendirme|profil|cihaz)/u.test(text);
  return /(kurulum|uygulama|kod|davet|ajans|destek|sorun|ekran|profil|foto|fotograf)/u.test(text);
}

function ownerTransferFact(section: OwnerTransferPolicySection): ConversationPolicyFact {
  return { id: `owner_transfer_${section.section_id}`, topic: "owner_transfer_knowledge", fact: section.content, content: section.content, source: "knowledge_bank", version: "app_facts_structured.json" };
}

export function resolveCandidatePolicy(
  state: UserState,
  _allowedApps: string[],
  structuredFacts: StructuredAppFact[] = [],
  generalWorkModel: StructuredGeneralWorkModel | null = null,
  intent: string | null = null,
  policySections: StructuredPolicySections | null = null,
  ownerTransferSections: OwnerTransferPolicySection[] = [],
): CandidatePolicyResolution {
  const facts: ConversationPolicyFact[] = [];
  const stage = resolvePolicyStage(state);
  const stageSections = [...STAGE_POLICY_SECTIONS[stage], ...ALWAYS_REQUIRED_CONSTRAINT_SECTIONS];
  const availableStageSections = stageSections.filter((key, index) => stageSections.indexOf(key) === index && policySections?.[key]?.trim());
  const rawSectionTokens = Math.ceil(availableStageSections.reduce((total, key) => total + (policySections?.[key]?.length ?? 0), 0) / 4);
  const selectedStageSections = rawSectionTokens > 2000
    ? [
        ...ALWAYS_REQUIRED_CONSTRAINT_SECTIONS.filter((key) => policySections?.[key]?.trim()),
        ...STAGE_POLICY_SECTIONS[stage].filter((key) => policySections?.[key]?.trim()),
      ].filter((key, index, keys) => keys.indexOf(key) === index).slice(0, 4)
    : availableStageSections;
  const seenSections = new Set<string>();
  for (const key of selectedStageSections) {
    const content = policySections?.[key]?.trim();
    if (!content || seenSections.has(key)) continue;
    seenSections.add(key);
    facts.push(structuredPolicySectionFact(key, key === "routing_matrix" ? prepareRoutingSection(content, stage) : content));
  }
  for (const section of ownerTransferSections.filter((item) => ownerTransferMatchesStage(item, stage))) facts.push(ownerTransferFact(section));

  const useGeneralWorkModel = generalWorkModel !== null && (stage === "intake" || ["ask_job_definition", "work_model_disclosure", "provide_work_model_disclosure"].includes(intent ?? ""));
  if (useGeneralWorkModel) facts.push(structuredGeneralWorkModelFact(generalWorkModel));
  const structuredFact = useGeneralWorkModel ? null : selectStructuredFact(state, structuredFacts);
  if (structuredFact) facts.push(structuredJobDefinitionFact(structuredFact));
  if (stage === "installation" && structuredFact) {
    facts.push(structuredAppFactForStage(structuredFact, stage));
  }
  if (stage === "app_selection") {
    const appCatalog = structuredFacts
      .filter((fact) => normalize(fact.status).includes("owner_approved"))
      .map((fact) => structuredAppFactForStage(fact, stage));
    for (const fact of appCatalog) facts.push(fact);
  }
  if (stage === "intake" && (state.gender === "erkek" || state.gender === "male") && generalWorkModel) {
    const profilePolicy = policySections?.profile_bio_photo_rules?.trim();
    const content = [
      `Published work model: ${generalWorkModel.summary}`,
      profilePolicy ? `Published profile policy: ${profilePolicy}` : "Do not invent an account or profile requirement.",
    ].join(" ");
    facts.push({ id: "male_candidate_work_model", topic: "male_candidate_work_model", fact: content, content, source: "runtime_contract", version: "responses_v3" });
    const acceptance = "After age, gender, and daily availability are captured, explain the work model clearly and ask for explicit acceptance before any setup, link, invite code, phone setup, or profile setup.";
    facts.push({ id: "work_model_acceptance_required", topic: "work_model_acceptance", fact: acceptance, content: acceptance, source: "runtime_contract", version: "responses_v3" });
    const steps = "The safe high-level explanation is: the candidate proceeds in the approved app, follows team guidance, and communicates through chats/messages; avoid unsupported claims about earnings, identity, account ownership, or hidden platform behavior.";
    facts.push({ id: "candidate_work_steps_chat_based", topic: "candidate_work_steps", fact: steps, content: steps, source: "runtime_contract", version: "responses_v3" });
  }

  const approvedApps = structuredFacts.filter((fact) => normalize(fact.status).includes("owner_approved")).map((fact) => fact.app);
  const secondaryApps = approvedApps.filter((candidate) => normalize(candidate) !== normalize(state.selected_app ?? ""));
  const routingMatrix = policySections?.routing_matrix?.trim();
  if (stage === "app_selection" && routingMatrix && approvedApps.length > 0) {
    const routingFact = prepareRoutingSection(routingMatrix, stage);
    facts.push({ id: "candidate_secondary_app_options", topic: "candidate_app_routing", fact: routingFact, content: routingFact, source: "knowledge_bank", version: "app_facts_structured.json" });
  }
  const policySectionIds = facts.filter((fact) => fact.id.startsWith("policy_section_")).map((fact) => fact.id.slice("policy_section_".length));
  const estimatedTokens = Math.ceil(facts.reduce((total, fact) => total + fact.content.length, 0) / 4);
  const missingStageSections = stageSections.filter((key) => !policySections?.[key]?.trim());
  return { facts, policyMissing: facts.length === 0, secondary_apps: secondaryApps, stage, policy_section_ids: policySectionIds, policy_context_token_estimate: estimatedTokens, missing_stage_sections: missingStageSections };
}

function structuredGeneralWorkModelFact(model: StructuredGeneralWorkModel): ConversationPolicyFact {
  const content = [`General work model: ${model.summary}`, `Workflow: ${model.workflow}`, `Earnings policy: ${model.earnings_policy}`, `Payment policy: ${model.payment_policy}`, `Setup boundary: ${model.setup_boundary}`].join(" ");
  return { id: "general_work_model", topic: "general_work_model", fact: content, content, source: "knowledge_bank", version: "app_facts_structured.json" };
}
