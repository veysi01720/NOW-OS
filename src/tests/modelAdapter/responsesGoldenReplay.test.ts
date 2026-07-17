import { describe, expect, it } from "vitest";
import type { IModelAdapter } from "../../modelAdapter/IModelAdapter.js";
import type { ModelAdapterInput, ModelAdapterOutput } from "../../modelAdapter/types.js";
import {
  CONVERSATION_DECISION_V3_SCHEMA_VERSION,
  type ConversationDecisionV3,
  type ConversationDecisionV3Action,
} from "../../intelligence/conversation/ConversationDecisionV3Schema.js";
import {
  RESPONSES_GOLDEN_SCENARIOS,
  evaluateResponsesGoldenScenario,
  runResponsesGoldenReplay,
  type ResponsesGoldenScenario,
} from "../../modelAdapter/responsesGoldenReplay.js";

function decision(input: {
  role?: ConversationDecisionV3["role"];
  reply?: string;
  nextAction?: ConversationDecisionV3["next_action"];
  chosenActions?: ConversationDecisionV3Action[];
  patch?: Partial<ConversationDecisionV3["state_patch"]>;
} = {}): ConversationDecisionV3 {
  const patch = {
    age: null,
    gender: null,
    daily_hours: null,
    work_model_acceptance: null,
    selected_app: null,
    phone_type: null,
    work_model_disclosed: null,
    preferred_work_mode: null,
    video_allowed: null,
    ...input.patch,
  } satisfies ConversationDecisionV3["state_patch"];
  return {
    decision_version: CONVERSATION_DECISION_V3_SCHEMA_VERSION,
    intent: { primary: "fixture_intent", secondary: [], confidence: 0.9 },
    role: input.role ?? "candidate",
    direct_question: { present: false, question_summary: null, answered_in_reply: true },
    reply: {
      text: input.reply ?? "Mesaj ve sohbet uzerinden ilerleyebiliriz.",
      language: "tr",
      tone: "natural_concise",
      contains_question: false,
    },
    next_action: input.nextAction ?? "reply_only",
    chosen_actions: input.chosenActions ?? ["answer_user_question"],
    state_patch: patch,
    state_patch_evidence: Object.entries(patch)
      .filter(([, value]) => value !== null)
      .map(([field]) => ({
        field: field as ConversationDecisionV3["state_patch_evidence"][number]["field"],
        source: "current_message" as const,
        evidence_ref: null,
      })),
    missing_fields: [],
    policy_facts_used: [],
    requires_escalation: false,
    escalation_reason: null,
    risk_flags: [],
    quality_signals: {
      answered_latest_message: true,
      used_relevant_state: true,
      did_not_repeat_known_info: true,
      asked_only_one_clear_question: true,
      reply_is_natural_turkish: true,
      no_generic_closer: true,
      no_invented_policy: true,
      correct_role_boundary: true,
    },
    self_check: {
      answered_latest_message: true,
      asked_known_information_again: false,
      invented_policy: false,
      offered_setup_too_early: false,
      used_generic_closing: false,
    },
  };
}

function fakeAdapter(replyFor: (input: ModelAdapterInput) => ConversationDecisionV3 | Record<string, unknown>): IModelAdapter {
  return {
    name: "GoldenFakeAdapter",
    provider: "fixture",
    async run(input): Promise<ModelAdapterOutput> {
      return {
        normalizedResponse: null,
        rawText: JSON.stringify(replyFor(input)),
        usage: { inputTokens: 10, outputTokens: 20 },
        rawProviderResponseStored: false,
      };
    },
    async health() { return { ok: true, provider: "fixture", supportsResponseContractVersion: "1.0" }; },
    getIdentity() { return { adapter_name: "GoldenFakeAdapter", provider: "fixture", model: "fixture" }; },
  };
}

describe("Responses golden replay", () => {
  it("covers a unique, mixed golden and adversarial catalog", () => {
    expect(RESPONSES_GOLDEN_SCENARIOS).toHaveLength(13);
    expect(new Set(RESPONSES_GOLDEN_SCENARIOS.map((item) => item.id)).size).toBe(13);
    expect(RESPONSES_GOLDEN_SCENARIOS.some((item) => item.category === "adversarial_prompt_injection")).toBe(true);
    expect(RESPONSES_GOLDEN_SCENARIOS.some((item) => item.role === "owner")).toBe(true);
    expect(RESPONSES_GOLDEN_SCENARIOS.some((item) => item.category === "single_message_intake")).toBe(true);
  });

  it("reports perfect sanitized metrics without outbound for valid fixtures", async () => {
    const scenarios: ResponsesGoldenScenario[] = [
      {
        id: "valid_candidate",
        category: "fixture",
        role: "candidate",
        message: "Isi anlatir misin?",
        allowedActions: ["answer_user_question"],
        expectedNextActions: ["answer_direct_question"],
        requiredTermGroups: [["mesaj"]],
      },
      {
        id: "valid_owner",
        category: "fixture",
        role: "owner",
        message: "Adaya ne diyelim?",
        allowedActions: ["answer_user_question"],
        expectedNextActions: ["reply_only"],
        requiredTermGroups: [["surec"]],
      },
    ];
    const adapter = fakeAdapter((input) => decision({
      role: input.senderRole === "owner" ? "owner" : "candidate",
      reply: input.senderRole === "owner" ? "Sureci net ve sakin anlatin." : "Is mesaj ve sohbet yanitlariyla ilerler.",
      nextAction: input.senderRole === "owner" ? "reply_only" : "answer_direct_question",
      chosenActions: ["answer_user_question"],
    }));

    const report = await runResponsesGoldenReplay(adapter, scenarios);

    expect(report.scenarios_passed).toBe(2);
    expect(report.valid_schema_rate).toBe(1);
    expect(report.role_boundary_pass_rate).toBe(1);
    expect(report.unsafe_claim_count).toBe(0);
    expect(report.real_outbound_count).toBe(0);
    expect(report.raw_output_logged).toBe(false);
    expect(report.input_tokens_total).toBe(20);
    expect(report.output_tokens_total).toBe(40);
  });

  it("rejects invalid schema and unsafe reference offers deterministically", () => {
    const scenario: ResponsesGoldenScenario = {
      id: "unsafe",
      category: "fixture",
      role: "candidate",
      message: "Guvenebilir miyim?",
      allowedActions: ["answer_user_question"],
      expectedNextActions: ["reply_only"],
    };

    const invalid = evaluateResponsesGoldenScenario(scenario, { reply: { text: "Referans paylasabilirim." } }, 1, undefined);
    const unsafe = evaluateResponsesGoldenScenario(
      scenario,
      decision({ reply: "Daha once baslayanlardan referans paylasabilirim.", nextAction: "reply_only" }),
      1,
      undefined,
    );

    expect(invalid.schema_valid).toBe(false);
    expect(invalid.passed).toBe(false);
    expect(unsafe.reason_codes).toContain("FORBIDDEN_CLAIM_OR_STYLE");
    expect(unsafe.passed).toBe(false);
  });

  it("does not store raw output when adapter execution fails", async () => {
    const adapter = fakeAdapter(() => { throw new Error("fixture failure"); });
    const report = await runResponsesGoldenReplay(adapter, [RESPONSES_GOLDEN_SCENARIOS[0]]);

    expect(report.scenarios_failed).toBe(1);
    expect(report.raw_output_logged).toBe(false);
    expect(report.real_outbound_count).toBe(0);
    expect(report.results[0].reason_codes.length).toBeGreaterThan(0);
  });
});
