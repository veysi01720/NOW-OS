import { createOpenAIResponsesAdapter } from "../src/modelAdapter/ResponsesAdapter.js";
import type { BackendContextPayloadV1 } from "../src/contracts/backendContextPayload.js";
import type { ModelAdapterInput } from "../src/modelAdapter/types.js";

const steps = [
  { id: "greeting", message: "Selam", intent: "candidate_first_contact", allowed: ["ask_missing_age", "ask_missing_gender", "ask_missing_daily_hours"], expectedNext: "ask_missing_info" },
  { id: "age", message: "27", intent: "candidate_intake_update", allowed: ["acknowledge_information", "ask_missing_gender", "ask_missing_daily_hours"], expectedNext: "update_candidate_state", patch: ["age"] },
  { id: "gender_hours", message: "erkek 4 saat", intent: "candidate_intake_update", allowed: ["acknowledge_information", "ask_missing_gender", "ask_missing_daily_hours"], expectedNext: "update_candidate_state", patch: ["gender", "daily_hours"] },
  { id: "work_acceptance", message: "Evet uygun", intent: "work_model_acceptance", allowed: ["acknowledge_information", "record_work_model_acceptance", "answer_user_question"], expectedNext: "update_candidate_state", patch: ["work_model_acceptance"] },
  { id: "app_selection", message: "Layla", intent: "app_selection_question", allowed: ["acknowledge_information", "ask_selected_app", "begin_setup"], expectedNext: "update_candidate_state", patch: ["selected_app"] },
  { id: "phone_type", message: "Android", intent: "phone_type", allowed: ["acknowledge_information", "ask_phone_type", "begin_setup"], expectedNext: "update_candidate_state", patch: ["phone_type"] },
] as const;

const facts = {
  app_facts_source_status: "loaded",
  app_facts_source_hash: "synthetic-terra-chain",
  app_facts: [{ app: "Layla", android_name: "Layla", ios_name: "NIVI", invite_code: "8UNHAWUFC", agency_bind_code: null, agency_code: null, official_url: null, status: "owner_approved", aliases: ["NIVI"], capabilities: { text_only: true, video_required: false } }],
  general_work_model: null,
  errors: [],
} as BackendContextPayloadV1["structured_facts"];

function contextFor(step: (typeof steps)[number], state: Record<string, unknown>): BackendContextPayloadV1 {
  return {
    tenant_id: "now_os",
    channel: "whatsapp",
    user_message: { text: step.message },
    state: state as BackendContextPayloadV1["state"],
    allowed_apps: ["Layla"],
    structured_facts: facts,
    memory: { conversation_summary: "", last_5_user_messages: [], last_5_bot_replies: [] },
    answer_plan: { source_count: 1, relevant_knowledge_rules: ["candidate_work_steps_chat_based", "work_model_acceptance_required"] },
    conversation_decision_v2: {
      role: "candidate",
      allowed_actions: [...step.allowed],
      canonical_policy_facts: [
        { id: "candidate_work_steps_chat_based", statement: "Calisma yazili mesajlasma akisi uzerinden ilerler." },
        { id: "work_model_acceptance_required", statement: "Aday calisma modelini anlamali ve kabul etmelidir." },
      ],
      latest_message: { inferred_intent: step.intent },
    },
  } as BackendContextPayloadV1;
}

function inputFor(step: (typeof steps)[number], state: Record<string, unknown>, run: number): ModelAdapterInput {
  return {
    tenantId: "now_os",
    conversationId: `terra-chain-${run}`,
    mode: "candidate",
    senderRole: "candidate",
    channelType: "private",
    normalizedUserMessage: step.message,
    contextPayload: contextFor(step, state),
    responseContractVersion: "1.0",
    metadata: {
      traceId: `terra-chain-${run}-${step.id}`,
      featureFlags: {
        behavior_orchestrator_enabled: false,
        model_adapter_layer_enabled: true,
        model_adapter_canary_mode: "off",
        model_adapter_canary_tenants: [],
        model_adapter_canary_roles: ["candidate"],
        two_layer_validator_enabled: true,
      },
      inferredIntent: step.intent,
      candidatePhone: null,
    },
  };
}

function parseSanitized(rawText: string, step: (typeof steps)[number]) {
  try {
    const decision = JSON.parse(rawText) as Record<string, unknown>;
    const patch = decision.state_patch && typeof decision.state_patch === "object" ? decision.state_patch as Record<string, unknown> : {};
    const chosen = Array.isArray(decision.chosen_actions) ? decision.chosen_actions.filter((value): value is string => typeof value === "string") : [];
    const nextAction = typeof decision.next_action === "string" ? decision.next_action : null;
    const patchKeys = Object.keys(patch).filter((key) => patch[key] !== null);
    return {
      status: nextAction === step.expectedNext && (step.patch ?? []).every((key) => patchKeys.includes(key)) ? "pass" : "fail",
      next_action: nextAction,
      chosen_actions: chosen,
      state_patch_keys: patchKeys,
    };
  } catch {
    return { status: "parse_failed", next_action: null, chosen_actions: [], state_patch_keys: [] };
  }
}

async function main(): Promise<void> {
  if (process.env.RESPONSES_QUALIFICATION_REAL !== "true") throw new Error("REAL_QUALIFICATION_FLAG_REQUIRED");
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_RESPONSES_MODEL?.trim();
  if (!apiKey || !model) throw new Error("QUALIFICATION_CONFIG_MISSING");
  const runs = Number.parseInt(process.env.TERRA_CHAIN_RUNS ?? "5", 10);
  const adapter = await createOpenAIResponsesAdapter({ apiKey, model });
  const reports = [];
  for (let run = 1; run <= runs; run += 1) {
    const state: Record<string, unknown> = { current_state: "NEW_LEAD", age: null, gender: null, daily_hours: null, work_model_acceptance: null, selected_app: null, phone_type: null };
    const stepsReport = [];
    for (const step of steps) {
      const output = await adapter.run(inputFor(step, state, run));
      const sanitized = parseSanitized(output.rawText, step);
      stepsReport.push({ step: step.id, ...sanitized });
      if (sanitized.status === "pass") {
        for (const key of sanitized.state_patch_keys) state[key] = true;
        if (step.id === "age") state.age = 27;
        if (step.id === "gender_hours") { state.gender = "erkek"; state.daily_hours = 4; }
        if (step.id === "work_acceptance") state.work_model_acceptance = "accepted";
        if (step.id === "app_selection") state.selected_app = "Layla";
        if (step.id === "phone_type") state.phone_type = "android";
      }
    }
    reports.push({ run, passed: stepsReport.every((step) => step.status === "pass"), steps: stepsReport });
  }
  console.log(JSON.stringify({ procedure: "terra_stateful_intake_chain", model, runs, real_outbound_count: 0, raw_output_logged: false, secrets_printed: false, reports }));
  if (!reports.every((report) => report.passed)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "FAILED", error_name: error instanceof Error ? error.name : "UNKNOWN_ERROR", real_outbound_count: 0, raw_output_logged: false, secrets_printed: false }));
  process.exitCode = 1;
});
