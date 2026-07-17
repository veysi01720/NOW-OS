import { describe, expect, it } from "vitest";
import { ResponsesAdapter } from "../../modelAdapter/ResponsesAdapter.js";
import {
  buildResponsesDecisionContext,
  buildResponsesSystemInstructions,
} from "../../modelAdapter/responsesDecisionPrompt.js";
import {
  RESPONSES_GOLDEN_SCENARIOS,
  buildResponsesGoldenAdapterInput,
} from "../../modelAdapter/responsesGoldenReplay.js";

describe("Responses decision context boundary", () => {
  it("uses the actual latest user message instead of the legacy V2 prompt", () => {
    const input = buildResponsesGoldenAdapterInput(RESPONSES_GOLDEN_SCENARIOS[1]);
    const context = buildResponsesDecisionContext(input);

    expect(context.latest_message).toBe(RESPONSES_GOLDEN_SCENARIOS[1].message);
    expect(context.latest_message).not.toContain("V2_PROMPT_MUST_NOT_BECOME_LATEST_MESSAGE");
  });

  it("projects provider-neutral context without transport identity or legacy instructions", () => {
    const input = buildResponsesGoldenAdapterInput(RESPONSES_GOLDEN_SCENARIOS[3]);
    (input.contextPayload as unknown as Record<string, unknown>).conversation_decision_v2_instructions = "legacy provider prompt";
    const serialized = JSON.stringify(buildResponsesDecisionContext(input));

    expect(serialized).not.toMatch(/sender_id|phone_number|remote_jid|message_id|golden_subject|golden_private_ref/);
    expect(serialized).not.toContain("conversation_decision_v2_instructions");
    expect(serialized).not.toContain("legacy provider prompt");
    expect(serialized).toContain("decision_context");
    expect(serialized).toContain("structured_facts");
    expect(serialized).toContain("NIVI");
    expect(serialized).toContain("M9W5B8");
  });

  it("keeps state, grounding, role, and no-outbound rules in backend-owned instructions", () => {
    const instructions = buildResponsesSystemInstructions();

    expect(instructions).toMatch(/backend owns authorization, state transitions, persistence, validation, and outbound delivery/i);
    expect(instructions).toMatch(/state_patch fields may change only/i);
    expect(instructions).toMatch(/chosen_actions must contain only exact backend domain action IDs/i);
    expect(instructions).toMatch(/next_action is a separate orchestration outcome/i);
    expect(instructions).toMatch(/state_patch_evidence/i);
    expect(instructions).toMatch(/use next_action=update_candidate_state/i);
    expect(instructions).toMatch(/normalize gender to erkek or kadin/i);
    expect(instructions).toMatch(/current_message evidence with evidence_ref=null/i);
    expect(instructions).toMatch(/preferred_work_mode=text_only and video_allowed=false/i);
    expect(instructions).toMatch(/do not invent app names, links, codes, earnings/i);
    expect(instructions).toMatch(/structured_facts as exact backend-approved facts/i);
    expect(instructions).toMatch(/at most one clear question/i);
    expect(instructions).toMatch(/never call tools, send messages, write state/i);
    expect(instructions).toMatch(/diagnostic only/i);
    expect(instructions).toMatch(/backend validators independently compute final quality/i);
  });

  it("sends store=false, strict V3 schema, and the projected context to Responses", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const input = buildResponsesGoldenAdapterInput(RESPONSES_GOLDEN_SCENARIOS[0]);
    const adapter = new ResponsesAdapter({
      model: "gpt-test-responses",
      runtime: { responses: { create: async (payload) => {
        calls.push(payload);
        return { status: "completed", output_text: "{}" };
      } } },
    });

    await adapter.run(input);
    const serialized = JSON.stringify(calls[0]);

    expect(calls[0].store).toBe(false);
    expect(serialized).toContain("conversation_decision_v3");
    expect(serialized).toContain(RESPONSES_GOLDEN_SCENARIOS[0].message);
    expect(serialized).not.toContain("V2_PROMPT_MUST_NOT_BECOME_LATEST_MESSAGE");
    expect(serialized).not.toMatch(/phone_number|remote_jid|golden_subject|golden_private_ref/);
  });
});
