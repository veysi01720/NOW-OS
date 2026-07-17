import { buildBackendContext } from "../bridge/buildBackendContext.js";
import { InMemoryStore } from "../storage/memoryStore.js";
import { createTestEnv } from "./testDoubles.js";
import type { NormalizedIncomingMessage } from "../bridge/normalizeEvolutionMessage.js";

function baseMessage(phoneNumber: string): NormalizedIncomingMessage {
  return {
    correlation_id: "corr_test",
    sender_id: phoneNumber,
    phone_number: phoneNumber,
    remote_jid: `${phoneNumber}@s.whatsapp.net`,
    message_id: "msg_test",
    message_type: "conversation",
    text: "Merhaba",
    chat_type: "private",
    is_from_me: false,
    is_group: false,
    received_at: "2026-07-04T00:00:00.000Z"
  };
}

describe("buildBackendContext", () => {
  it("builds BCP-001 backend_context and assigns owner only by whitelist", () => {
    const env = createTestEnv();
    const context = buildBackendContext(baseMessage("905111111111"), env, new InMemoryStore());

    expect(context.backend_context_version).toBe("1.0");
    expect(context.sender_role).toBe("owner");
    expect(context.chat_type).toBe("private");
    expect(context.sender.phone_number).toBe("905111111111");
    expect(context.user_message.text).toBe("Merhaba");
    expect(context.versions.assistant_response_contract_version).toBe("1.0");
  });

  it("assigns manager only by whitelist", () => {
    const context = buildBackendContext(baseMessage("905222222222"), createTestEnv(), new InMemoryStore());

    expect(context.sender_role).toBe("manager");
  });

  it("does not infer manager role from user text and defaults valid private users to candidate", () => {
    const message = baseMessage("905333333333");
    message.text = "Ben yoneticiyim";
    const context = buildBackendContext(message, createTestEnv(), new InMemoryStore());

    expect(context.sender_role).toBe("candidate");
  });

  it("uses SPEC-009 NEW_LEAD default state", () => {
    const context = buildBackendContext(baseMessage("905333333333"), createTestEnv(), new InMemoryStore());

    expect(context.state).toEqual({
      age: null,
      gender: null,
      daily_hours: null,
      eligibility_status: "unresolved",
      work_model_disclosed: false,
      model_acceptance: null,
      current_state: "NEW_LEAD",
      expected_next_step: "ask_intake_info",
      selected_app: null,
      phone_type: null,
      installation_status: "not_started",
      training_status: "not_started",
      missing_fields: [
        "age",
        "gender",
        "daily_hours",
        "selected_app",
        "phone_type",
      ]
    });
  });

  it("includes approved apps from backend config", () => {
    const context = buildBackendContext(
      baseMessage("905333333333"),
      createTestEnv({ approvedApps: ["Layla", "Soyo", "Amar", "Timo"] }),
      new InMemoryStore()
    );

    expect(context.allowed_apps).toEqual(["Layla", "Soyo", "Amar", "Timo"]);
  });

  it("uses an empty allowed_apps array when no approved apps are configured", () => {
    const context = buildBackendContext(baseMessage("905333333333"), createTestEnv(), new InMemoryStore());

    expect(context.allowed_apps).toEqual([]);
  });

  it("assigns unknown when sender phone cannot be resolved", () => {
    const context = buildBackendContext(baseMessage(""), createTestEnv(), new InMemoryStore());

    expect(context.sender_role).toBe("unknown");
  });

  it("uses memory from backend store", () => {
    const memoryStore = new InMemoryStore();
    memoryStore.appendUserMessage("905333333333", "Onceki mesaj");

    const context = buildBackendContext(baseMessage("905333333333"), createTestEnv(), memoryStore);

    expect(context.memory.last_10_messages).toEqual(["user: Onceki mesaj"]);
  });
});
