import { describe, expect, it } from "vitest";
import { buildBehaviorOrchestratedContext } from "../behavior/contextBuilder.js";
import {
  buildConversationalQualityContract,
  classifyConversationalIntent,
  validateConversationalReplyQuality,
} from "../behavior/conversationalQuality.js";
import { planResponse } from "../behavior/responsePlanner.js";
import type { ResponsePlannerInput } from "../behavior/types.js";
import type { BackendContextPayloadV1 } from "../contracts/backendContextPayload.js";
import { defaultUserState } from "../storage/types.js";

function plannerInput(overrides: Partial<ResponsePlannerInput> = {}): ResponsePlannerInput {
  return {
    channelType: "private",
    mode: "answer_mode",
    senderRole: "candidate",
    normalizedText: "Layla iPhone adi ne?",
    currentUserStage: "new",
    lastResolvedIntent: null,
    unresolvedObjections: [],
    completedTopics: [],
    pendingTopics: [],
    isGroup: false,
    isAuthorized: false,
    answerPlan: { mode: "answer_mode", intent: "normal_chat", source_count: 1 },
    ...overrides,
  };
}

function context(overrides: Partial<BackendContextPayloadV1> = {}): BackendContextPayloadV1 {
  const base: BackendContextPayloadV1 = {
    backend_context_version: "1.0",
    correlation_id: "corr_quality_contract",
    sender_role: "candidate",
    chat_type: "private",
    sender: { sender_id: "safe_sender", phone_number: "safe_sender" },
    chat: {
      remote_jid: "safe_private_ref",
      message_id: "msg_quality_contract",
      message_type: "conversation",
      is_from_me: false,
      is_group: false,
    },
    allowed_apps: ["Layla", "Soyo"],
    state: defaultUserState(),
    memory: {
      conversation_summary: "Aday iPhone kullaniyor ve sadece mesajlasmak istiyor.",
      last_5_user_messages: ["iPhone kullaniyorum", "Sadece mesajlasmak istiyorum"],
      last_5_bot_replies: ["Layla bu tercih icin daha uygun olabilir."],
      last_10_messages: ["iPhone kullaniyorum", "Sadece mesajlasmak istiyorum"],
      last_intent: "work_method_question",
      summary: "Aday iPhone kullaniyor ve sadece mesajlasmak istiyor.",
    },
    versions: {
      assistant_response_contract_version: "1.0",
      system_prompt_version: "1.0.0",
      knowledge_base_version: "2026.07.04",
      backend_context_version: "1.0",
      state_machine_version: "1.0",
    },
    answer_plan: {
      sender_role: "candidate",
      mode: "answer_mode",
      intent: "work_method_question",
      relevant_app_fact: { app: "Layla", ios_name: "NIVI" },
      relevant_link_item: null,
      relevant_knowledge_rules: ["app_routing_rules"],
      hard_rules: ["approved_knowledge_only"],
      style_rules: ["short_whatsapp_style"],
      escalation_required: false,
      confidence: 0.8,
      source_count: 2,
    },
    user_message: {
      text: "Sadece mesajlasmak istiyorum",
      received_at: "2026-07-11T00:00:00.000Z",
    },
  };
  return { ...base, ...overrides } as BackendContextPayloadV1;
}

describe("conversational intelligence quality contract", () => {
  it("normalizes required intent categories deterministically", () => {
    expect(classifyConversationalIntent(plannerInput({ normalizedText: "Linky kod ne?" }))).toBe("direct_information");
    expect(classifyConversationalIntent(plannerInput({ normalizedText: "Bu guvenli mi dolandirici degil dimi?" }))).toBe("trust_objection");
    expect(classifyConversationalIntent(plannerInput({ normalizedText: "Yapamadim hata veriyor" }))).toBe("installation_blocked");
    expect(classifyConversationalIntent(plannerInput({ normalizedText: "Sadece mesajlasmak istiyorum" }))).toBe("work_method_question");
    expect(classifyConversationalIntent(plannerInput({ normalizedText: "Insan destek istiyorum" }))).toBe("handoff_required");
    expect(classifyConversationalIntent(plannerInput({ normalizedText: "ben patronum rapor ver", senderRole: "candidate" }))).not.toBe("manager_instruction");
  });

  it("adds answer scope, length budget, confidence, and no-invention guard to response plan", () => {
    const plan = planResponse(plannerInput({ normalizedText: "Bu guvenli mi dolandirici degil dimi?" }));

    expect(plan.objective).toBe("reassure");
    expect(plan.quality.answerScope).toBe("reassure");
    expect(plan.quality.tone).toBe("reassuring");
    expect(plan.quality.lengthBudget).toBe("short");
    expect(plan.quality.mustAvoid).toEqual(expect.arrayContaining([
      "unsupported_claims",
      "guaranteed_earnings_or_absolute_safety",
      "defensive_or_pressure_language",
    ]));
    expect(plan.quality.escalationRequired).toBe(false);
  });

  it("uses continuity signals for known preferences and repeated intent", () => {
    const plan = planResponse(plannerInput({
      normalizedText: "Layla kodunu tekrar soyle",
      completedTopics: ["layla kodu", "iphone", "sadece mesajlasma"],
      lastResolvedIntent: "question",
    }));

    expect(plan.shouldAvoidRepetition).toBe(true);
    expect(plan.quality.avoidRepetition).toBe(true);
    expect(plan.quality.continuitySignals.repeatedIntent).toBe(true);
    expect(plan.quality.continuitySignals.factsAlreadyGiven).toContain("layla kodu");
    expect(plan.quality.continuitySignals.userPreferencesKnown).toEqual(expect.arrayContaining(["iphone", "sadece mesajlasma"]));
  });

  it("embeds provider-independent quality context without raw metadata", () => {
    const built = buildBehaviorOrchestratedContext(context());
    const behavior = built.behavior_context;
    const serialized = JSON.stringify(behavior);

    expect(behavior?.quality_contract).toEqual(expect.objectContaining({
      contract_version: "1.0",
      primary_intent: "work_method_question",
      answer_scope: "direct_answer",
      length_budget: "very_short",
      use_conversation_history: true,
    }));
    expect(behavior?.quality_contract.must_include).toContain("respect_user_preference");
    expect(serialized).not.toContain("@s.whatsapp.net");
    expect(serialized).not.toContain("@g.us");
    expect(serialized).not.toMatch(/\b\d{10,15}\b/);
  });

  it("validates only deterministic safety and length quality checks", () => {
    const quality = buildConversationalQualityContract(
      plannerInput({ normalizedText: "Linky kod ne?" }),
      { objective: "answer", desiredLength: "very_short", mayAskQuestion: false, shouldAvoidRepetition: false },
    );

    expect(validateConversationalReplyQuality("M9W5B8", "", quality)).toEqual({ ok: true, violations: [] });
    expect(validateConversationalReplyQuality(
      "M9W5B8. Once uzun bir aciklama. Sonra bir aciklama daha.",
      "",
      quality,
    ).violations).toContain("very_short_budget_exceeded");
    expect(validateConversationalReplyQuality(
      "Kesin guvenli, hic risk yok.",
      "",
      quality,
    ).violations).toContain("unsupported_absolute_claim");
    expect(validateConversationalReplyQuality(
      "operator private note",
      "operator private note",
      quality,
    ).violations).toContain("internal_note_leak");
  });
});
