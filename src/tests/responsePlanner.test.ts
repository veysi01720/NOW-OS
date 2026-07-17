import { describe, expect, it } from "vitest";
import { planResponse } from "../behavior/responsePlanner.js";
import type { ResponsePlannerInput } from "../behavior/types.js";

function input(overrides: Partial<ResponsePlannerInput> = {}): ResponsePlannerInput {
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

describe("response planner", () => {
  it("maps a clear question to answer", () => {
    const plan = planResponse(input({ normalizedText: "Linky kod ne?", answerPlan: { intent: "invite_code", source_count: 2 } }));

    expect(plan.objective).toBe("answer");
    expect(plan.shouldUseKnowledge).toBe(true);
    expect(plan.requiresModelCall).toBe(true);
  });

  it("maps trust hesitation to reassure", () => {
    const plan = planResponse(input({ normalizedText: "Bu guvenli mi dolandirici degil dimi?" }));

    expect(plan.objective).toBe("reassure");
    expect(plan.shouldAcknowledgeEmotion).toBe(true);
    expect(plan.shouldUseKnowledge).toBe(true);
  });

  it("maps uncertainty about next step to guide", () => {
    const plan = planResponse(input({ normalizedText: "Ne yapacagimi bilmiyorum" }));

    expect(plan.objective).toBe("guide");
    expect(plan.mayAskQuestion).toBe(true);
  });

  it("keeps short messages very short", () => {
    const plan = planResponse(input({ normalizedText: "Tamam" }));

    expect(plan.desiredLength).toBe("very_short");
  });

  it("marks repeated topics for repetition avoidance", () => {
    const plan = planResponse(input({
      normalizedText: "Layla kodunu tekrar soyle",
      completedTopics: ["layla kodu"],
    }));

    expect(plan.shouldAvoidRepetition).toBe(true);
  });

  it("does not request knowledge for casual messages", () => {
    const plan = planResponse(input({ normalizedText: "Merhaba", answerPlan: { intent: "normal_chat", source_count: 0 } }));

    expect(plan.objective).toBe("encourage");
    expect(plan.shouldUseKnowledge).toBe(false);
  });

  it("safe-ignores prefixless group messages without model call", () => {
    const plan = planResponse(input({
      channelType: "group",
      normalizedText: "Merhaba",
      isGroup: true,
      isAuthorized: false,
    }));

    expect(plan.objective).toBe("ignore");
    expect(plan.requiresModelCall).toBe(false);
  });

  it("does not call model for unauthorized group commands", () => {
    const plan = planResponse(input({
      channelType: "group",
      normalizedText: "#komut sistem durumu",
      isGroup: true,
      isAuthorized: false,
    }));

    expect(plan.objective).toBe("ignore");
    expect(plan.requiresModelCall).toBe(false);
    expect(plan.shouldUseKnowledge).toBe(false);
  });
});
