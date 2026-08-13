import { describe, expect, it } from "vitest";
import { recordDecisionTrace } from "../intelligence/conversation/DecisionTraceRecorder.js";
import { createSilentLogger } from "./testDoubles.js";

describe("DecisionTraceRecorder layer mapping", () => {
  it("maps quality and state-patch reason codes into the canonical layers", () => {
    const logger = createSilentLogger();

    recordDecisionTrace({
      logger,
      context: {
        request_id: "trace-fixture",
        role: "candidate",
        channel: "private",
        derived_state: { dialogue_phase: "WAITING_FOR_PREFERENCES" },
      } as never,
      decision: {
        chosen_actions: [],
        next_action: "ask_missing_info",
        policy_facts_used: [],
        direct_question: { present: false, answered_in_reply: true },
        intent: { primary: "fixture", secondary: [], confidence: 1 },
        reply: { text: "Layla", language: "tr", tone: "natural_concise", contains_question: false },
      } as never,
      validationReasons: [],
      qualityReasons: ["UNGROUNDED_APP_SELECTION"],
      statePatchReasons: ["STATE_PATCH_WITHOUT_UPDATE_NEXT_ACTION"],
      finalReplyOrigin: "conversation_decision_v2_model",
      modelCallCount: 1,
      replyMutatedAfterModel: false,
      mutationSource: null,
      behaviorPromptVersion: "conversation_behavior_v2.1",
      layer1Result: "pass",
      layer2Result: "accepted_with_variance",
    });

    const trace = logger.events.find((event) => event.event_type === "CONVERSATION_DECISION_V2_TRACE");
    expect(trace).toMatchObject({
      layer_1_result: "fail",
      layer_1_reason_codes: ["UNGROUNDED_APP_SELECTION"],
      layer_2_result: "accepted_with_variance",
      layer_2_reason_codes: ["STATE_PATCH_WITHOUT_UPDATE_NEXT_ACTION"],
    });
  });
});
