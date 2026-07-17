import { describe, expect, it } from "vitest";
import type { BackendContextPayloadV1 } from "../contracts/backendContextPayload.js";
import { buildBehaviorOrchestratedContext } from "../behavior/contextBuilder.js";
import type { ConversationState } from "../behavior/types.js";

function context(overrides: Partial<BackendContextPayloadV1> = {}): BackendContextPayloadV1 {
  const base: BackendContextPayloadV1 = {
    backend_context_version: "1.0",
    correlation_id: "corr_context_builder",
    sender_role: "candidate",
    chat_type: "private",
    sender: {
      sender_id: "905333333333",
      phone_number: "905333333333",
    },
    chat: {
      remote_jid: "905333333333@s.whatsapp.net",
      message_id: "msg_context_builder",
      message_type: "conversation",
      is_from_me: false,
      is_group: false,
    },
    allowed_apps: ["Layla", "Soyo"],
    state: {
      current_state: "exploring",
      age: null,
      gender: null,
      daily_hours: null,
      selected_app: null,
      phone_type: "android",
      installation_status: "not_started",
      training_status: "not_started",
      missing_fields: ["selected_app"],
      expected_next_step: "ask_selected_app",
    },
    memory: {
      conversation_summary: "Aday android bilgisini verdi ve uygulama secimi bekleniyor.",
      last_5_user_messages: ["Merhaba", "Android", "Sadece mesajlasmak istiyorum"],
      last_5_bot_replies: ["Hangi uygulama uzerinden ilerleyecegini netlestirelim."],
      last_10_messages: [
        "Merhaba",
        "Hangi uygulama uzerinden ilerleyecegini netlestirelim.",
        "Android",
        "Android",
        "Sadece mesajlasmak istiyorum",
        "Sadece mesajlasmak istiyorum",
        "Uzun mesaj ".repeat(80),
        "Layla hakkinda bilgi alabilir miyim?",
        "Tesekkur ederim",
        "Tamam",
        "Son mesaj",
      ],
      last_intent: "app_routing",
      summary: "Aday android bilgisini verdi ve uygulama secimi bekleniyor.",
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
      intent: "app_routing",
      relevant_app_fact: { app: "Layla", ios_name: "NIVI" },
      relevant_link_item: null,
      relevant_knowledge_rules: ["app_routing_rules", "safe_trust_wording"],
      hard_rules: ["no_fake_links"],
      style_rules: ["short_answer"],
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

describe("behavior context builder", () => {
  it("adds behavior context without changing legacy context fields", () => {
    const original = context();
    const built = buildBehaviorOrchestratedContext(original);

    expect(built.behavior_context).toBeDefined();
    expect(built.sender_role).toBe(original.sender_role);
    expect(built.chat_type).toBe(original.chat_type);
    expect(built.state).toEqual(original.state);
    expect(original.behavior_context).toBeUndefined();
    expect(built.behavior_context?.output_contract_reminder).toContain("Assistant Response Contract v1.0");
  });

  it("caps and deduplicates recent message previews", () => {
    const built = buildBehaviorOrchestratedContext(context());
    const recent = built.behavior_context?.recent_messages ?? [];
    const previews = recent.map((message: { preview: string }) => message.preview);

    expect(recent.length).toBeLessThanOrEqual(8);
    expect(new Set(previews.map((preview: string) => preview.toLocaleLowerCase("tr-TR"))).size).toBe(previews.length);
    expect(previews.every((preview: string) => preview.length <= 240)).toBe(true);
  });

  it("summarizes retrieval signals without promoting raw app facts into profile rules", () => {
    const built = buildBehaviorOrchestratedContext(context());
    const behavior = built.behavior_context;

    expect(behavior?.retrieved_knowledge_summary).toEqual({
      source_count: 2,
      rule_ids: ["app_routing_rules", "safe_trust_wording"],
      relevant_app_present: true,
      relevant_link_present: false,
    });
    expect(JSON.stringify(behavior?.behavior_profile)).not.toContain("NIVI");
    expect(JSON.stringify(behavior?.behavior_profile)).not.toContain("M9W5B8");
  });

  it("keeps behavior metadata free of raw phone, jid, and group identifiers", () => {
    const built = buildBehaviorOrchestratedContext(context());
    const metadata = JSON.stringify(built.behavior_context?.metadata);

    expect(metadata).not.toContain("905333333333");
    expect(metadata).not.toContain("@s.whatsapp.net");
    expect(metadata).not.toContain("@g.us");
  });

  it("uses sanitized conversation state service snapshot when provided", () => {
    const loadedState: ConversationState = {
      tenantId: "now_os",
      conversationId: "corr_context_builder",
      channelType: "private",
      currentMode: "answer_mode",
      userStage: "hesitant",
      lastResolvedIntent: "hesitation",
      unresolvedObjections: ["905333333333 guven sorusu"],
      completedTopics: ["intro", "phone_type", "selected_app", "extra1", "extra2", "extra3", "extra4", "extra5", "extra6"],
      pendingTopics: ["trust_check"],
      lastAssistantAction: "provide_guidance",
      lastUserSentiment: "neutral",
      escalationStatus: "none",
      summary: "User previously asked about NVIDIA. Has no laptop.",
      textOnlyPreference: false,
      updatedAt: "2026-07-11T00:00:00.000Z",
    };

    const built = buildBehaviorOrchestratedContext(context(), loadedState);
    const snapshot = built.behavior_context?.conversation_state_snapshot;
    const serializedSnapshot = JSON.stringify(snapshot);

    expect(snapshot?.user_stage).toBe("hesitant");
    expect(snapshot?.unresolved_objections).toHaveLength(1);
    expect(snapshot?.completed_topics.length).toBeLessThanOrEqual(8);
    expect(snapshot?.pending_topics).toEqual(["trust_check"]);
    expect(serializedSnapshot).not.toContain("905333333333");
    expect(serializedSnapshot).not.toContain("@s.whatsapp.net");
    expect(serializedSnapshot).not.toContain("internal_boss_note");
  });
});
