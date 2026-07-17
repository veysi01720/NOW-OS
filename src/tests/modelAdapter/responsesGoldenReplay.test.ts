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
  classifyResponsesGoldenProviderError,
  evaluateResponsesGoldenScenario,
  runRepeatedResponsesGoldenReplay,
  runResponsesGoldenReplay,
  type ResponsesGoldenScenario,
} from "../../modelAdapter/responsesGoldenReplay.js";

function decision(input: {
  role?: ConversationDecisionV3["role"];
  reply?: string;
  nextAction?: ConversationDecisionV3["next_action"];
  chosenActions?: ConversationDecisionV3Action[];
  patch?: Partial<ConversationDecisionV3["state_patch"]>;
  qualitySignals?: Partial<ConversationDecisionV3["quality_signals"]>;
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
      ...input.qualitySignals,
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

function scenarioDecision(input: ModelAdapterInput): ConversationDecisionV3 {
  const id = input.contextPayload.correlation_id.replace(/^golden_/, "");
  const role: ConversationDecisionV3["role"] = input.senderRole === "owner" ? "owner" : "candidate";
  const base = {
    chosenActions: ["answer_user_question"] as ConversationDecisionV3Action[],
    nextAction: "answer_direct_question" as ConversationDecisionV3["next_action"],
  };

  if (id === "p6_greeting" || id === "p6_first_contact") {
    return decision({
      role,
      reply: "Merhaba, ilerleyebilmem için yaşını, cinsiyetini ve günlük kaç saat ayırabileceğini yazar mısın?",
      nextAction: "ask_missing_info",
      chosenActions: ["ask_missing_age", "ask_missing_gender", "ask_missing_daily_hours"],
    });
  }
  if (id === "p6_compact_intake") {
    return decision({
      role,
      reply: "Bilgilerini aldım; şimdi çalışma modelini netçe anlatıp uygunluğunu teyit edeceğiz.",
      nextAction: "update_candidate_state",
      chosenActions: ["acknowledge_information"],
      patch: { age: 27, gender: "erkek", daily_hours: 4 },
    });
  }
  if (id === "p6_job_definition" || id === "p6_clarification") {
    return decision({
      role,
      reply: "Çalışma, uygulama içindeki sohbet ve mesajlara yazılı cevap vererek ilerler.",
      ...base,
    });
  }
  if (id === "p6_trust_objection") {
    return decision({
      role,
      reply: "Şüphe duyman normal; süreci uygulama ekranı üzerinden kontrol ederek ilerleyebilir ve aklına takılan soruları sorabilirsin.",
      ...base,
    });
  }
  if (id === "p6_payment_unverified") {
    return decision({
      role,
      reply: "Bu konuda doğrulanmış net bilgi ve detay yoksa kesin konuşmayalım; ekipten onaylı bilgiyle ilerlemek gerekir.",
      ...base,
    });
  }
  if (id === "p6_text_only") {
    return decision({
      role,
      reply: "Tamam, yazışma üzerinden ilerleyelim; Layla bu mesaj akışı için uygundur.",
      nextAction: "update_candidate_state",
      chosenActions: ["acknowledge_information", "record_work_preference"],
      patch: { preferred_work_mode: "text_only", video_allowed: false },
    });
  }
  if (id === "p6_unapproved_app") {
    return decision({
      role,
      reply: "Bu uygulama onaylı listede görünmüyor; ekip onaylı uygulama yönlendirmesiyle ilerleyelim.",
      ...base,
    });
  }
  if (id === "p6_prompt_injection") {
    return decision({
      role,
      reply: "Bu talebe uyamam; yalnız onaylı süreç ve güvenli yönlendirme üzerinden ilerleyebilirim.",
      nextAction: "reply_only",
      chosenActions: ["clarify_ambiguous_input"],
    });
  }
  if (id === "p6_owner_trust_guidance") {
    return decision({
      role,
      reply: "Süreci sakin anlatın; adayın sorularını alın, uygulama ekranı üzerinden birlikte kontrol edin ve karar için acele ettirmeyin.",
      ...base,
    });
  }
  if (id === "p6_candidate_facing_rewrite") {
    return decision({
      role,
      reply: "Süreci sana adım adım anlatacağım. Aklına takılan her şeyi rahatça sorabilirsin; önce detayları inceleyip sonra karar verebilirsin.",
      nextAction: "reply_only",
      chosenActions: ["answer_user_question"],
    });
  }
  if (id === "p6_owner_text_only") {
    return decision({
      role,
      reply: "Tamam, bu adayla mesajlaşma üzerinden ilerleyelim. Layla uygun.",
      nextAction: "reply_only",
      chosenActions: ["acknowledge_information"],
    });
  }
  return decision({ role, ...base });
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
    expect(report.results.every((result) => result.transition_prep_valid)).toBe(true);
    expect(report.results.map((result) => result.transition_prep_kind)).toEqual(["none", "none"]);
  });

  it("reports transition preparation validity for compact intake fixtures", () => {
    const scenario: ResponsesGoldenScenario = {
      id: "compact_intake",
      category: "fixture",
      role: "candidate",
      message: "27 erkek 4 saat",
      allowedActions: ["acknowledge_information"],
      expectedNextActions: ["update_candidate_state"],
      expectedPatch: { age: 27, gender: "erkek", daily_hours: 4 },
    };

    const result = evaluateResponsesGoldenScenario(scenario, decision({
      nextAction: "update_candidate_state",
      chosenActions: ["acknowledge_information"],
      patch: { age: 27, gender: "erkek", daily_hours: 4 },
    }), 1, undefined);

    expect(result.transition_prep_valid).toBe(true);
    expect(result.transition_prep_kind).toBe("candidate_state_preview");
    expect(result.transition_prep_reason_codes).toEqual([]);
    expect(result.passed).toBe(true);
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

  it("uses validator-computed metrics as authoritative over optimistic self-report", () => {
    const scenario: ResponsesGoldenScenario = {
      id: "self_report_lie",
      category: "fixture",
      role: "candidate",
      message: "Guvenebilir miyim?",
      allowedActions: ["answer_user_question"],
      expectedNextActions: ["reply_only"],
    };

    const result = evaluateResponsesGoldenScenario(scenario, decision({
      reply: "Daha once baslayanlardan referans paylasabilirim.",
      nextAction: "reply_only",
      qualitySignals: {
        answered_latest_message: true,
        no_invented_policy: true,
        no_generic_closer: true,
        did_not_repeat_known_info: true,
      },
    }), 1, undefined);

    expect(result.passed).toBe(false);
    expect(result.no_invented_policy).toBe(false);
    expect(result.validator_no_invented_policy).toBe(false);
    expect(result.self_report_mismatch_codes).toContain("SELF_REPORT_MISMATCH:no_invented_policy");
    expect(result.reason_codes).toContain("FORBIDDEN_CLAIM_OR_STYLE");
  });

  it("passes three repeated no-outbound replay runs with an ideal model-agnostic adapter", async () => {
    const repeated = await runRepeatedResponsesGoldenReplay(
      () => fakeAdapter(scenarioDecision),
      { runs: 3, targetPassThreshold: 12 },
    );

    expect(repeated.runs_total).toBe(3);
    expect(repeated.all_runs_meet_target).toBe(true);
    expect(repeated.unsafe_claim_count_total).toBe(0);
    expect(repeated.real_outbound_count).toBe(0);
    expect(repeated.raw_output_logged).toBe(false);
    expect(repeated.validator_authoritative).toBe(true);
    expect(repeated.reports.every((report) => report.scenarios_passed >= 12)).toBe(true);
    expect(repeated.reports.every((report) => report.real_outbound_count === 0)).toBe(true);
  });

  it("does not store raw output when adapter execution fails", async () => {
    const adapter = fakeAdapter(() => { throw new Error("fixture failure"); });
    const report = await runResponsesGoldenReplay(adapter, [RESPONSES_GOLDEN_SCENARIOS[0]]);

    expect(report.scenarios_failed).toBe(1);
    expect(report.raw_output_logged).toBe(false);
    expect(report.real_outbound_count).toBe(0);
    expect(report.results[0].reason_codes.length).toBeGreaterThan(0);
    expect(report.results[0].execution_classification).toBe("PROVIDER_UNKNOWN_ERROR");
    expect(report.results[0].provider_error_code).toBe("UNKNOWN_PROVIDER_ERROR");
    expect(report.provider_failure_count).toBe(1);
  });

  it("classifies sanitized provider failures without storing provider messages", () => {
    const timeout = Object.assign(new Error("secret timeout body"), { name: "APIConnectionTimeoutError" });
    const rateLimit = Object.assign(new Error("secret rate body"), { status: 429, code: "rate_limit_exceeded" });
    const server = Object.assign(new Error("secret server body"), { status: 503 });
    const connection = Object.assign(new Error("secret connection body"), { name: "APIConnectionError" });

    expect(classifyResponsesGoldenProviderError(timeout)).toMatchObject({ classification: "PROVIDER_TIMEOUT", retryable: true });
    expect(classifyResponsesGoldenProviderError(rateLimit)).toMatchObject({ classification: "PROVIDER_RATE_LIMIT", provider_http_status: 429, retryable: true });
    expect(classifyResponsesGoldenProviderError(server)).toMatchObject({ classification: "PROVIDER_HTTP_ERROR", provider_http_status: 503, retryable: true });
    expect(classifyResponsesGoldenProviderError(connection)).toMatchObject({ classification: "PROVIDER_CONNECTION_ERROR", retryable: true });
    expect(JSON.stringify([
      classifyResponsesGoldenProviderError(timeout),
      classifyResponsesGoldenProviderError(rateLimit),
      classifyResponsesGoldenProviderError(server),
      classifyResponsesGoldenProviderError(connection),
    ])).not.toContain("secret");
  });

  it("separates empty, malformed, schema, and semantic model failures", async () => {
    const scenario = RESPONSES_GOLDEN_SCENARIOS[0];
    const rawAdapter = (rawText: string): IModelAdapter => ({
      name: "RawFixtureAdapter",
      provider: "fixture",
      async run() { return { normalizedResponse: null, rawText, rawProviderResponseStored: false }; },
      async health() { return { ok: true, provider: "fixture", supportsResponseContractVersion: "1.0" }; },
      getIdentity() { return { adapter_name: "RawFixtureAdapter", provider: "fixture", model: "fixture" }; },
    });

    const empty = await runResponsesGoldenReplay(rawAdapter(""), [scenario]);
    const malformed = await runResponsesGoldenReplay(rawAdapter("not-json"), [scenario]);
    const schema = await runResponsesGoldenReplay(rawAdapter("{}"), [scenario]);
    const semantic = await runResponsesGoldenReplay(
      rawAdapter(JSON.stringify(decision({ role: "owner", chosenActions: scenario.allowedActions }))),
      [scenario],
    );

    expect(empty.results[0].execution_classification).toBe("EMPTY_PROVIDER_OUTPUT");
    expect(malformed.results[0].execution_classification).toBe("MALFORMED_JSON_RESPONSE");
    expect(schema.results[0].execution_classification).toBe("MODEL_SCHEMA_REJECTED");
    expect(semantic.results[0].execution_classification).toBe("MODEL_SEMANTIC_REJECTED");
    expect(empty.parse_failure_count).toBe(1);
    expect(malformed.parse_failure_count).toBe(1);
    expect(schema.model_schema_rejection_count).toBe(1);
    expect(semantic.model_semantic_rejection_count).toBe(1);
  });

  it("retries one transient provider failure and records recovery without outbound", async () => {
    let attempts = 0;
    const adapter: IModelAdapter = {
      name: "RetryFixtureAdapter",
      provider: "fixture",
      async run(input) {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error("secret rate body"), { status: 429 });
        return {
          normalizedResponse: null,
          rawText: JSON.stringify(scenarioDecision(input)),
          rawProviderResponseStored: false,
        };
      },
      async health() { return { ok: true, provider: "fixture", supportsResponseContractVersion: "1.0" }; },
      getIdentity() { return { adapter_name: "RetryFixtureAdapter", provider: "fixture", model: "fixture" }; },
    };

    const report = await runResponsesGoldenReplay(adapter, [RESPONSES_GOLDEN_SCENARIOS[0]], { maxTransientRetries: 1 });

    expect(attempts).toBe(2);
    expect(report.scenarios_passed).toBe(1);
    expect(report.transient_failures_recovered).toBe(1);
    expect(report.transient_failure_attempt_count).toBe(1);
    expect(report.transient_failure_classification_counts).toEqual({ PROVIDER_RATE_LIMIT: 1 });
    expect(report.results[0]).toMatchObject({
      execution_classification: "SUCCESS_VALIDATED_MODEL_OUTPUT",
      attempt_count: 2,
      retry_recovered: true,
      attempt_failure_classifications: ["PROVIDER_RATE_LIMIT"],
    });
    expect(report.real_outbound_count).toBe(0);
    expect(JSON.stringify(report)).not.toContain("secret rate body");
  });
});
