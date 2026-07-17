import { describe, expect, it } from "vitest";
import {
  CandidateTransitionMutex,
  prepareConversationDecisionV3Transition,
} from "../intelligence/conversation/ConversationDecisionV3TransitionPreparation.js";
import {
  CONVERSATION_DECISION_V3_SCHEMA_VERSION,
  type ConversationDecisionV3,
  type ConversationDecisionV3Action,
  type ConversationDecisionV3StatePatchField,
} from "../intelligence/conversation/ConversationDecisionV3Schema.js";
import type { ConversationDecisionV3SemanticContext } from "../intelligence/conversation/ConversationDecisionV3SemanticValidator.js";
import { defaultUserState, type UserState } from "../storage/types.js";

function context(input: Partial<ConversationDecisionV3SemanticContext> = {}): ConversationDecisionV3SemanticContext {
  return {
    role: "candidate",
    channel_type: "private",
    latest_message: "27 erkek 4 saat",
    candidate_state: defaultUserState(),
    allowed_apps: ["Layla"],
    allowed_actions: ["acknowledge_information", "record_work_preference", "escalate_policy_missing"],
    canonical_policy_fact_ids: ["work_fact"],
    ...input,
  };
}

function decision(input: {
  next_action?: ConversationDecisionV3["next_action"];
  chosen_actions?: ConversationDecisionV3Action[];
  patch?: Partial<ConversationDecisionV3["state_patch"]>;
  evidence?: ConversationDecisionV3["state_patch_evidence"];
  requires_escalation?: boolean;
  escalation_reason?: string | null;
  reply?: string;
} = {}): ConversationDecisionV3 {
  const patch: ConversationDecisionV3["state_patch"] = {
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
  };
  const evidence = input.evidence ?? Object.entries(patch)
    .filter(([, value]) => value !== null)
    .map(([field]) => ({
      field: field as ConversationDecisionV3StatePatchField,
      source: "current_message" as const,
      evidence_ref: null,
    }));

  return {
    decision_version: CONVERSATION_DECISION_V3_SCHEMA_VERSION,
    intent: { primary: "fixture", secondary: [], confidence: 0.92 },
    role: "candidate",
    direct_question: { present: false, question_summary: null, answered_in_reply: true },
    reply: { text: input.reply ?? "Bilgilerini aldım.", language: "tr", tone: "natural_concise", contains_question: false },
    next_action: input.next_action ?? "update_candidate_state",
    chosen_actions: input.chosen_actions ?? ["acknowledge_information"],
    state_patch: patch,
    state_patch_evidence: evidence,
    missing_fields: [],
    policy_facts_used: [],
    requires_escalation: input.requires_escalation ?? false,
    escalation_reason: input.escalation_reason ?? null,
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

describe("ConversationDecisionV3 transition preparation", () => {
  it("creates a non-mutating compact intake state preview", () => {
    const current = defaultUserState();
    const result = prepareConversationDecisionV3Transition(decision({
      patch: { age: 27, gender: "erkek", daily_hours: 4 },
    }), context({ candidate_state: current }));

    expect(result.valid).toBe(true);
    expect(result.non_mutating).toBe(true);
    expect(result.transition_kind).toBe("candidate_state_preview");
    expect(result.captured_fields).toEqual(["age", "gender", "daily_hours"]);
    expect(result.proposed_state.age).toBe(27);
    expect(result.proposed_state.gender).toBe("erkek");
    expect(result.proposed_state.daily_hours).toBe(4);
    expect(result.current_state.age).toBeNull();
    expect(current.age).toBeNull();
    expect(result.state_write_count).toBe(0);
    expect(result.outbound_count).toBe(0);
  });

  it("previews text-only preference atomically without persistence", () => {
    const result = prepareConversationDecisionV3Transition(decision({
      chosen_actions: ["acknowledge_information", "record_work_preference"],
      patch: { preferred_work_mode: "text_only", video_allowed: false },
    }), context({
      latest_message: "Sadece mesajlaşmak istiyorum, görüntülü istemiyorum",
      allowed_actions: ["acknowledge_information", "record_work_preference"],
    }));

    expect(result.valid).toBe(true);
    expect(result.transition_kind).toBe("candidate_state_preview");
    expect(result.proposed_state.behavior_conversation_state?.preferredWorkMode).toBe("text_only");
    expect(result.proposed_state.behavior_conversation_state?.videoAllowed).toBe(false);
    expect(result.state_write_count).toBe(0);
  });

  it("maps explicit missing-info escalation without state mutation", () => {
    const result = prepareConversationDecisionV3Transition(decision({
      next_action: "escalate_missing_info",
      chosen_actions: ["escalate_policy_missing"],
      requires_escalation: true,
      escalation_reason: "missing verified payment detail",
    }), context({ allowed_actions: ["escalate_policy_missing"] }));

    expect(result.valid).toBe(true);
    expect(result.transition_kind).toBe("missing_info_escalation");
    expect(result.changed_fields).toEqual([]);
    expect(result.state_write_count).toBe(0);
    expect(result.outbound_count).toBe(0);
  });

  it("denies non-candidate and group transition preparation", () => {
    const owner = prepareConversationDecisionV3Transition(decision({
      patch: { age: 27 },
    }), context({ role: "owner", allowed_actions: ["acknowledge_information"] }));
    expect(owner.valid).toBe(false);
    expect(owner.reason_codes).toContain("TRANSITION_AUTHORITY_DENIED");

    const group = prepareConversationDecisionV3Transition(decision({
      patch: { age: 27 },
    }), context({ channel_type: "group" }));
    expect(group.valid).toBe(false);
    expect(group.reason_codes).toContain("TRANSITION_AUTHORITY_DENIED");
  });

  it("keeps invalid semantic decisions from producing state previews", () => {
    const result = prepareConversationDecisionV3Transition(decision({
      patch: { selected_app: "TikTok" },
    }), context({ latest_message: "TikTok seçelim" }));

    expect(result.valid).toBe(false);
    expect(result.transition_kind).toBe("none");
    expect(result.reason_codes).toContain("STATE_PATCH_APP_NOT_APPROVED");
    expect(result.proposed_state.selected_app).toBeNull();
  });

  it("prevents same-candidate concurrent transition evaluation without queue cutover", async () => {
    const mutex = new CandidateTransitionMutex();
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = mutex.runExclusive("candidate-a", async () => {
      await blocker;
      return "first_done";
    });
    await Promise.resolve();

    const second = await mutex.runExclusive("candidate-a", async () => "second_done");
    const otherCandidate = await mutex.runExclusive("candidate-b", async () => "other_done");
    release();

    expect(second).toEqual({ acquired: false, reason: "candidate_transition_in_progress" });
    expect(otherCandidate).toEqual({ acquired: true, value: "other_done" });
    await expect(first).resolves.toEqual({ acquired: true, value: "first_done" });
    expect(mutex.isLocked("candidate-a")).toBe(false);
  });

  it("does not mutate the source state object", () => {
    const current: UserState = defaultUserState();
    const before = JSON.stringify(current);
    prepareConversationDecisionV3Transition(decision({
      patch: { age: 27, gender: "erkek", daily_hours: 4 },
    }), context({ candidate_state: current }));

    expect(JSON.stringify(current)).toBe(before);
  });
});
