import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenAIOwnerNaturalLanguageIntentClassifier } from "../src/bridge/ownerNaturalLanguageIntent.js";
import { loadStructuredAppFacts } from "../src/bridge/structuredAppFacts.js";
import type { BackendContextPayloadV1 } from "../src/contracts/backendContextPayload.js";
import { createOpenAIResponsesAdapter } from "../src/modelAdapter/ResponsesAdapter.js";
import type { ModelAdapterInput } from "../src/modelAdapter/types.js";
import { PersistentHumanHandoffStore } from "../src/store/humanHandoffStore.js";

const apiKey = process.env.OPENAI_API_KEY?.trim();
const model = process.env.OPENAI_RESPONSES_MODEL?.trim();
if (process.env.RESPONSES_QUALIFICATION_REAL !== "true") throw new Error("REAL_QUALIFICATION_FLAG_REQUIRED");
if (!apiKey || !model) throw new Error("OPENAI_API_KEY_AND_OPENAI_RESPONSES_MODEL_REQUIRED");

const loaded = loadStructuredAppFacts();
const approvedApps = loaded.app_facts.filter((fact) => fact.status.includes("owner_approved"));
if (approvedApps.length === 0) throw new Error("OWNER_APPROVED_APP_FACTS_REQUIRED");
type AppFact = (typeof approvedApps)[number];

function publishedCode(fact: AppFact): string | null {
  return fact.invite_code?.trim() ?? fact.agency_bind_code?.trim() ?? fact.agency_code?.trim() ?? null;
}

const classifier = await createOpenAIOwnerNaturalLanguageIntentClassifier({ apiKey, model, timeoutMs: 60_000 });
const pendingScenarios = [
  { question: "TanChat kurulum kodu nedir?", followup: "kodu hatırlıyor musun" },
  { question: "Çekim talebi hangi gün veriliyor?", followup: "peki günlük müydü" },
  { question: "Kurulum ekranındaki ajans alanında ne yapılacak?", followup: "o ekranda neye bakacağız" },
];
const pendingIntentResults: boolean[] = [];
for (const [index, scenario] of pendingScenarios.entries()) {
  const decision = await classifier.classify({
    message: scenario.followup,
    activeKnowledge: "",
    pendingKnowledge: [],
    pendingCandidateSuffixes: ["5165"],
    pendingHandoffs: [{
      handoff_id: `qualification-handoff-${index + 1}`,
      candidate_suffix: "5165",
      question_sanitized: scenario.question,
      failure_reason: "verified_knowledge_missing_or_unavailable",
      team_escalated: false,
    }],
  });
  pendingIntentResults.push(decision.intent === "normal_chat" && decision.pending_handoff_related === true);
}

const adapter = await createOpenAIResponsesAdapter({ apiKey, model, timeoutMs: 60_000 });
function input(role: "owner" | "candidate", message: string, traceId: string, fact: AppFact): ModelAdapterInput {
  const code = publishedCode(fact);
  const structuredFacts = {
    app_facts_source_status: loaded.source_status,
    app_facts_source_hash: loaded.source_hash,
    app_facts: loaded.app_facts,
    general_work_model: loaded.general_work_model,
    policy_sections: loaded.policy_sections,
    owner_transfer_sections: loaded.owner_transfer_sections,
    errors: loaded.errors,
  };
  const canonicalFact = {
    id: `structured_app_fact_${fact.app.toLocaleLowerCase("tr-TR").replace(/[^a-z0-9]+/gu, "_")}`,
    topic: "installation_application_facts",
    fact: `Approved application: ${fact.app}. Android display name: ${fact.android_name}. iOS display name: ${fact.ios_name}. Invite code: ${code ?? "not published"}. Official download link: ${fact.official_url ?? "not published"}.`,
    content: `Approved application: ${fact.app}. Android display name: ${fact.android_name}. iOS display name: ${fact.ios_name}. Invite code: ${code ?? "not published"}. Official download link: ${fact.official_url ?? "not published"}.`,
    source: "knowledge_bank",
    version: "app_facts_structured.json",
  };
  const contextPayload = {
    tenant_id: "now_os",
    channel: "whatsapp",
    sender_role: role,
    chat_type: "private",
    user_message: { text: message },
    state: {
      current_state: role === "candidate" ? "INSTALLATION_IN_PROGRESS" : "NON_CANDIDATE",
      age: role === "candidate" ? 29 : null,
      gender: role === "candidate" ? "erkek" : null,
      daily_hours: role === "candidate" ? 4 : null,
      work_model_acceptance: role === "candidate" ? "accepted" : null,
      selected_app: role === "candidate" ? fact.app : null,
      phone_type: role === "candidate" ? "android" : null,
    },
    structured_facts: structuredFacts,
    memory: { conversation_summary: "", last_5_user_messages: [], last_5_bot_replies: [] },
    conversation_decision_v2: {
      role,
      channel: "private",
      latest_message: { text: message, inferred_intent: role === "owner" ? "app_fact_question" : "installation_question" },
      candidate_state: role === "candidate"
        ? { age: 29, gender: "erkek", daily_hours: 4, work_model_acceptance: "accepted", selected_app: fact.app, phone_type: "android" }
        : { age: null, gender: null, daily_hours: null, work_model_acceptance: null, selected_app: null, phone_type: null },
      allowed_actions: role === "owner"
        ? ["answer_user_question"]
        : ["answer_user_question", "provide_installation_instruction", "begin_setup", "escalate_policy_missing"],
      canonical_policy_facts: [canonicalFact],
    },
  } as unknown as BackendContextPayloadV1;
  return {
    tenantId: "now_os",
    conversationId: traceId,
    mode: "conversation_decision_v2",
    senderRole: role,
    channelType: "private",
    normalizedUserMessage: message,
    contextPayload,
    responseContractVersion: "1.0",
    metadata: {
      traceId,
      featureFlags: {
        behavior_orchestrator_enabled: false,
        model_adapter_layer_enabled: true,
        model_adapter_canary_mode: "off",
        model_adapter_canary_tenants: [],
        model_adapter_canary_roles: [role],
        two_layer_validator_enabled: true,
      },
      inferredIntent: role === "owner" ? "app_fact_question" : "installation_question",
      candidatePhone: role === "candidate" ? "905000000000" : null,
    },
  };
}

function sanitizeDecision(rawText: string): { reply: string; requiresEscalation: boolean | null } {
  const parsed = JSON.parse(rawText) as { reply?: { text?: unknown }; requires_escalation?: unknown };
  return {
    reply: typeof parsed.reply?.text === "string" ? parsed.reply.text : "",
    requiresEscalation: typeof parsed.requires_escalation === "boolean" ? parsed.requires_escalation : null,
  };
}

const appResults: Array<{ app: string; owner: boolean; candidate: boolean; escalated: boolean | null }> = [];
for (const fact of approvedApps) {
  const code = publishedCode(fact);
  const ownerDecision = sanitizeDecision((await adapter.run(input(
    "owner",
    `${fact.app} için yayınlanmış kod neydi?`,
    `terra-owner-app-fact-${fact.app}`,
    fact,
  ))).rawText);
  const candidateDecision = sanitizeDecision((await adapter.run(input(
    "candidate",
    `${fact.app} kurulumuna nasıl başlayacağım?`,
    `terra-candidate-installation-${fact.app}`,
    fact,
  ))).rawText);
  const routeEvidence = [fact.official_url?.trim(), code].filter((value): value is string => Boolean(value));
  appResults.push({
    app: fact.app,
    owner: code === null || ownerDecision.reply.includes(code),
    candidate: routeEvidence.some((value) => candidateDecision.reply.includes(value)),
    escalated: candidateDecision.requiresEscalation,
  });
}

const representative = approvedApps[0];
const missingFactDecision = sanitizeDecision((await adapter.run(input(
  "candidate",
  "Kurulum için yayınlanmış özel destek hattı nedir?",
  "terra-missing-operational-fact",
  representative,
))).rawText);
const tempRoot = mkdtempSync(join(tmpdir(), "terra-handoff-qualification-"));
let persistedMissingFactHandoff = false;
try {
  const store = new PersistentHumanHandoffStore(join(tempRoot, "handoffs.json"));
  if (missingFactDecision.requiresEscalation === true) {
    store.createOwnerQuery({
      tenant_id: "now_os",
      conversation_key_hash: "qualification-candidate",
      source_correlation_id: "terra-missing-operational-fact",
      candidate_phone: "905000000000",
      question_sanitized: "Kurulum için yayınlanmış özel destek hattı nedir?",
      failure_reason: "verified_knowledge_missing_or_unavailable",
    });
  }
  persistedMissingFactHandoff = store.findPendingOwnerQuery() !== null;
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

const checks = {
  pending_handoff_topics_bound: pendingIntentResults.every(Boolean),
  every_owner_app_fact_answered: appResults.every((result) => result.owner),
  every_candidate_app_has_grounded_route: appResults.every((result) => result.candidate),
  no_published_app_route_escalated: appResults.every((result) => result.escalated === false),
  missing_fact_requires_escalation: missingFactDecision.requiresEscalation === true,
  missing_fact_handoff_persisted: persistedMissingFactHandoff,
};
const passed = Object.values(checks).every(Boolean);
process.stdout.write(`${JSON.stringify({
  model,
  mode: "real_terra_no_outbound",
  checks,
  approved_app_count: approvedApps.length,
  app_results: appResults,
  pending_handoff_topic_count: pendingScenarios.length,
  pending_handoff_topic_pass_count: pendingIntentResults.filter(Boolean).length,
  real_outbound_count: 0,
  raw_output_logged: false,
  secrets_printed: false,
  passed,
}, null, 2)}\n`);
if (!passed) process.exitCode = 1;
