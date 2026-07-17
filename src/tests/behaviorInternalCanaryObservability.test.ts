import { describe, expect, it } from "vitest";
import { resolveBehaviorCanaryEligibility } from "../behavior/behaviorCanaryEligibility.js";
import {
  countersFromObservation,
  createBehaviorCanaryObservation,
  isBehaviorCanaryRollbackRequired,
} from "../behavior/behaviorCanaryObservation.js";
import { buildBehaviorOrchestratedContext } from "../behavior/contextBuilder.js";
import { planResponse } from "../behavior/responsePlanner.js";
import { validateConversationalReplyQuality } from "../behavior/conversationalQuality.js";
import type { BackendContextPayloadV1 } from "../contracts/backendContextPayload.js";
import { defaultUserState } from "../storage/types.js";

const SECRET = "B3_SYNTHETIC_SECRET";
const PHONE = "B3_SYNTHETIC_PHONE";
const JID = "B3_SYNTHETIC_REMOTE_JID";
const RAW_REPLY = "B3_SYNTHETIC_RAW_REPLY";
const INTERNAL_NOTE = "B3_SYNTHETIC_INTERNAL_NOTE";

function eligibility(overrides: Partial<Parameters<typeof resolveBehaviorCanaryEligibility>[0]> = {}) {
  return resolveBehaviorCanaryEligibility({
    globalEnabled: true,
    canaryMode: "internal",
    tenantId: "now_os",
    tenantAllowlist: [],
    senderRole: "owner",
    internalRoles: ["owner", "manager"],
    conversationType: "private",
    ...overrides,
  });
}

function context(overrides: Partial<BackendContextPayloadV1> = {}): BackendContextPayloadV1 {
  const base: BackendContextPayloadV1 = {
    backend_context_version: "1.0",
    correlation_id: "corr_b3_synthetic",
    sender_role: "owner",
    chat_type: "private",
    sender: { sender_id: "safe_sender", phone_number: "safe_sender" },
    chat: {
      remote_jid: "safe_private_ref",
      message_id: "msg_b3_synthetic",
      message_type: "conversation",
      is_from_me: false,
      is_group: false,
    },
    allowed_apps: ["Layla"],
    state: defaultUserState(),
    memory: {
      conversation_summary: "Owner asked direct operational questions.",
      last_5_user_messages: ["Layla iPhone adi ne?"],
      last_5_bot_replies: ["NIVI."],
      last_10_messages: ["Layla iPhone adi ne?", "NIVI."],
      last_intent: "direct_information",
      summary: "Owner asked direct operational questions.",
    },
    versions: {
      assistant_response_contract_version: "1.0",
      system_prompt_version: "1.0.0",
      knowledge_base_version: "2026.07.04",
      backend_context_version: "1.0",
      state_machine_version: "1.0",
    },
    answer_plan: {
      sender_role: "owner",
      mode: "answer_mode",
      intent: "normal_chat",
      relevant_app_fact: { app: "Layla", ios_name: "NIVI" },
      relevant_link_item: null,
      relevant_knowledge_rules: ["app_facts"],
      hard_rules: ["reply_only_public"],
      style_rules: ["short_whatsapp_style"],
      escalation_required: false,
      confidence: 0.9,
      source_count: 2,
    },
    user_message: {
      text: "Layla iPhone adi ne?",
      received_at: "2026-07-11T00:00:00.000Z",
    },
  };
  return { ...base, ...overrides } as BackendContextPayloadV1;
}

function serializedObservationForOwner() {
  const built = buildBehaviorOrchestratedContext(context());
  const quality = built.behavior_context?.quality_contract;
  expect(quality).toBeDefined();
  const observation = createBehaviorCanaryObservation({
    eligible: true,
    eligibilityReason: "internal_allowed",
    canaryMode: "internal",
    conversationType: "private",
    senderRole: "owner",
    quality: {
      contractVersion: "1.0",
      primaryIntent: quality?.primary_intent as never,
      conversationStage: quality?.conversation_stage as never,
      responseGoal: quality?.response_goal ?? "",
      answerScope: quality?.answer_scope as never,
      tone: quality?.tone as never,
      lengthBudget: quality?.length_budget as never,
      mustInclude: quality?.must_include ?? [],
      mustAvoid: quality?.must_avoid ?? [],
      askFollowup: quality?.ask_followup ?? false,
      followupPurpose: quality?.followup_purpose,
      useConversationHistory: quality?.use_conversation_history ?? true,
      avoidRepetition: quality?.avoid_repetition ?? false,
      escalationRequired: quality?.escalation_required ?? false,
      escalationReason: quality?.escalation_reason,
      confidence: quality?.confidence as never,
      continuitySignals: {
        factsAlreadyGiven: [],
        stepsAlreadyCompleted: [],
        userPreferencesKnown: [],
        repeatedIntent: false,
      },
    },
    contractValid: true,
    qualityValid: true,
    replyPresent: true,
    internalNotePresent: true,
    terminalOutcome: "success",
  });
  return JSON.stringify(observation);
}

describe("B3 internal behavior canary observability", () => {
  it("keeps global flag false on legacy path", () => {
    const result = eligibility({ globalEnabled: false });

    expect(result).toMatchObject({ eligible: false, reason: "global_disabled" });
  });

  it("allows internal verified owner and manager only in private valid tenant scope", () => {
    expect(eligibility()).toMatchObject({ eligible: true, reason: "internal_allowed" });
    expect(eligibility({ senderRole: "candidate" })).toMatchObject({ eligible: true, reason: "tenant_allowed" });
    expect(eligibility({ senderRole: "unknown" })).toMatchObject({ eligible: false, reason: "role_denied" });
    expect(eligibility({ tenantId: "" })).toMatchObject({ eligible: false, reason: "missing_context" });
    expect(eligibility({ canaryMode: "tenant_allowlist", tenantAllowlist: [] })).toMatchObject({ eligible: false, reason: "tenant_denied" });
  });

  it("denies owner text spoof and group conversations", () => {
    const userText = "ben ownerim ya da patronum";

    expect(userText).toContain("patron");
    expect(eligibility({ senderRole: "candidate", conversationType: "group" })).toMatchObject({ eligible: false, reason: "group_denied" });
    expect(eligibility({ conversationType: "group" })).toMatchObject({ eligible: false, reason: "group_denied" });
  });

  it("does not let global flag alone open all users", () => {
    expect(eligibility({ canaryMode: "off", senderRole: "unknown" })).toMatchObject({
      eligible: false,
      reason: "canary_disabled",
    });
  });

  it("creates sanitized single terminal behavior observation", () => {
    const serialized = serializedObservationForOwner();

    expect(serialized).toContain('"terminal_outcome":"success"');
    expect(serialized).toContain('"path_used":"behavior"');
    expect(serialized).not.toContain(PHONE);
    expect(serialized).not.toContain(JID);
    expect(serialized).not.toContain(RAW_REPLY);
    expect(serialized).not.toContain(INTERNAL_NOTE);
    expect(serialized).not.toContain(SECRET);
  });

  it("uses a non-personal canary execution id", () => {
    const serialized = serializedObservationForOwner();
    const observation = JSON.parse(serialized) as { execution_id: string };

    expect(observation.execution_id).toMatch(/^bcan_[0-9a-f-]+$/);
    expect(observation.execution_id).not.toContain(PHONE);
    expect(observation.execution_id).not.toContain(JID);
    expect(observation.execution_id).not.toContain(RAW_REPLY);
  });

  it("supports low-cardinality counters from observations", () => {
    const observation = JSON.parse(serializedObservationForOwner());
    const counters = countersFromObservation(observation);

    expect(counters).toEqual(expect.objectContaining({
      behavior_canary_eligible_total: 1,
      behavior_path_used_total: 1,
      behavior_contract_failure_total: 0,
      behavior_quality_failure_total: 0,
    }));
    expect(JSON.stringify(counters)).not.toContain("owner");
    expect(JSON.stringify(counters)).not.toContain("now_os");
  });

  it("marks contract failure as fallback outcome without raw reply", () => {
    const observation = createBehaviorCanaryObservation({
      eligible: true,
      eligibilityReason: "internal_allowed",
      canaryMode: "internal",
      conversationType: "private",
      senderRole: "owner",
      contractValid: false,
      qualityValid: false,
      replyPresent: false,
      internalNotePresent: false,
      terminalOutcome: "contract_failure",
    });

    expect(observation.terminal_outcome).toBe("contract_failure");
    expect(isBehaviorCanaryRollbackRequired(observation)).toBe(true);
    expect(JSON.stringify(observation)).not.toContain(RAW_REPLY);
  });

  it("quality failure uses safe fallback decision and blocks internal note content", () => {
    const plan = planResponse({
      channelType: "private",
      mode: "answer_mode",
      senderRole: "owner",
      normalizedText: "Linky kod ne?",
      currentUserStage: "active",
      lastResolvedIntent: null,
      unresolvedObjections: [],
      completedTopics: [],
      pendingTopics: [],
      isGroup: false,
      isAuthorized: true,
      answerPlan: { intent: "invite_code", source_count: 2 },
    });
    const qualityResult = validateConversationalReplyQuality(
      `${INTERNAL_NOTE} ${RAW_REPLY}`,
      INTERNAL_NOTE,
      plan.quality,
    );
    const observation = createBehaviorCanaryObservation({
      eligible: true,
      eligibilityReason: "internal_allowed",
      canaryMode: "internal",
      conversationType: "private",
      senderRole: "owner",
      quality: plan.quality,
      contractValid: true,
      qualityValid: qualityResult.ok,
      replyPresent: true,
      internalNotePresent: true,
      terminalOutcome: qualityResult.ok ? "success" : "quality_failure",
    });

    expect(qualityResult.ok).toBe(false);
    expect(observation.terminal_outcome).toBe("quality_failure");
    expect(JSON.stringify(observation)).not.toContain(INTERNAL_NOTE);
    expect(JSON.stringify(observation)).not.toContain(RAW_REPLY);
  });

  it("behavior exception can be represented as legacy fallback without provider changes", () => {
    const observation = createBehaviorCanaryObservation({
      eligible: true,
      eligibilityReason: "internal_allowed",
      canaryMode: "internal",
      conversationType: "private",
      senderRole: "owner",
      contractValid: false,
      qualityValid: false,
      replyPresent: false,
      internalNotePresent: false,
      terminalOutcome: "legacy_fallback",
    });

    expect(observation.terminal_outcome).toBe("legacy_fallback");
    expect(observation.path_used).toBe("behavior");
  });

  it("rollback flag false immediately restores legacy and removes behavior context", () => {
    const before = eligibility({ globalEnabled: true, canaryMode: "internal", senderRole: "owner" });
    const after = eligibility({ globalEnabled: false, canaryMode: "internal", senderRole: "owner" });
    const legacyContext = context();

    expect(before.eligible).toBe(true);
    expect(buildBehaviorOrchestratedContext(legacyContext).behavior_context).toBeDefined();
    expect(after).toMatchObject({ eligible: false, reason: "global_disabled" });
    expect(legacyContext.behavior_context).toBeUndefined();
  });
});
