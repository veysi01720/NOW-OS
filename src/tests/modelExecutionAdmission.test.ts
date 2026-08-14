import { describe, expect, it } from "vitest";
import { ModelExecutionService } from "../modelAdapter/modelExecutionService.js";

function input(index: number): any {
  return {
    tenantId: "now_os", conversationId: `admission-${index}`, mode: "candidate", senderRole: "candidate", channelType: "private",
    normalizedUserMessage: "Selam", responseContractVersion: "1.0",
    contextPayload: { tenant_id: "now_os", channel: "whatsapp", user_message: { text: "Selam" }, state: {}, allowed_apps: [], conversation_decision_v2: { allowed_actions: ["answer_user_question"], canonical_policy_facts: [] } },
    metadata: { traceId: `admission-${index}`, inferredIntent: "candidate_first_contact", candidatePhone: null, featureFlags: { model_adapter_layer_enabled: false, model_adapter_canary_mode: "off", model_adapter_canary_intents: [] } },
  };
}

describe("model execution admission control", () => {
  it("queues a 200-call burst without dropping calls", async () => {
    let active = 0;
    let maxActive = 0;
    const service = new ModelExecutionService({} as any, {} as any, {
      modelAdapterLayerEnabled: false,
      modelAdapterCanaryMode: "off",
      adapterFactory: () => ({
        name: "TestAdapter",
        provider: "test",
        run: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 2));
          active -= 1;
          return { rawText: "ok", normalizedResponse: null };
        },
      } as any),
    });

    const results = await Promise.all(Array.from({ length: 200 }, (_, index) => service.execute(input(index))));
    expect(results).toHaveLength(200);
    expect(maxActive).toBeLessThanOrEqual(64);
    expect(service.snapshot().model_execution_admission).toMatchObject({ max_concurrent: 64, completed: 200, active: 0, queued: 0 });
  });
});
