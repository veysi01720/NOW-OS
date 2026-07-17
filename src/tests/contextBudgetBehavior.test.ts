import { describe, expect, it } from "vitest";
import type { BackendContextPayloadV1 } from "../contracts/backendContextPayload.js";
import { buildBehaviorOrchestratedContext } from "../behavior/contextBuilder.js";

function baseContext(): BackendContextPayloadV1 {
  return {
    backend_context_version: "1.0",
    correlation_id: "corr_budget_behavior",
    sender_role: "candidate",
    chat_type: "private",
    sender: {
      sender_id: "905333333333",
      phone_number: "905333333333",
    },
    chat: {
      remote_jid: "905333333333@s.whatsapp.net",
      message_id: "msg_budget_behavior",
      message_type: "conversation",
      is_from_me: false,
      is_group: false,
    },
    allowed_apps: ["Layla"],
    state: {
      current_state: "exploring",
      age: null,
      gender: null,
      daily_hours: null,
      selected_app: null,
      phone_type: null,
      installation_status: "not_started",
      training_status: "not_started",
      missing_fields: ["selected_app", "phone_type"],
      expected_next_step: "ask_selected_app_or_phone_type",
    },
    memory: {
      conversation_summary: "ozet ".repeat(300),
      last_5_user_messages: ["Isi bilmeden uygulama secemem"],
      last_5_bot_replies: ["Hangi uygulama uzerinden ilerleyecegini netlestirelim."],
      last_10_messages: Array.from({ length: 20 }, (_, index) => `mesaj ${index % 4}`),
      summary: "ozet ".repeat(300),
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
      intent: "app_selection",
      relevant_app_fact: { app: "Layla" },
      relevant_link_item: null,
      relevant_knowledge_rules: Array.from({ length: 20 }, (_, index) => `rule_${index}`),
      hard_rules: [],
      style_rules: [],
      escalation_required: false,
      confidence: 0.7,
      source_count: 3,
    },
    user_message: {
      text: "Isi bilmeden uygulama secemem",
      received_at: "2026-07-11T00:00:00.000Z",
    },
  };
}

describe("behavior context budget", () => {
  it("truncates long summaries and caps recent messages", () => {
    const built = buildBehaviorOrchestratedContext(baseContext());
    const behavior = built.behavior_context;

    expect(behavior?.conversation_state_snapshot.summary.length).toBeLessThanOrEqual(600);
    expect(behavior?.recent_messages.length).toBeLessThanOrEqual(8);
  });

  it("deduplicates repeated recent content while preserving retrieval summary", () => {
    const built = buildBehaviorOrchestratedContext(baseContext());
    const behavior = built.behavior_context;
    const previews = behavior?.recent_messages.map((message: { preview: string }) => message.preview) ?? [];

    expect(new Set(previews).size).toBe(previews.length);
    expect(behavior?.retrieved_knowledge_summary?.source_count).toBe(3);
    expect(behavior?.retrieved_knowledge_summary?.rule_ids.length).toBeLessThanOrEqual(8);
    expect(behavior?.retrieved_knowledge_summary?.relevant_app_present).toBe(true);
  });
});
