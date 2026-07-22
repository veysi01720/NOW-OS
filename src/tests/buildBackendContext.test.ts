import { buildBackendContext, getConversationKey, getTenantConversationKey } from "../bridge/buildBackendContext.js";
import { InMemoryStore } from "../storage/memoryStore.js";
import { createTestEnv } from "./testDoubles.js";
import type { NormalizedIncomingMessage } from "../bridge/normalizeEvolutionMessage.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeValidKnowledgeBankFixture } from "./fixtures/knowledgeBankFixture.js";

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
  it("builds stable tenant-scoped model conversation keys by tenant and chat id", () => {
    const first = baseMessage("905333333333");
    first.message_id = "msg_1";
    const second = baseMessage("905333333333");
    second.message_id = "msg_2";
    second.correlation_id = "corr_second";
    const otherPrivate = baseMessage("905444444444");
    const groupFirst: NormalizedIncomingMessage = {
      ...baseMessage("905333333333"),
      remote_jid: "120363000000000000@g.us",
      chat_type: "group",
      is_group: true,
      message_id: "group_msg_1",
    };
    const groupSecond: NormalizedIncomingMessage = {
      ...groupFirst,
      phone_number: "905444444444",
      sender_id: "905444444444",
      message_id: "group_msg_2",
    };
    const otherGroup: NormalizedIncomingMessage = {
      ...groupFirst,
      remote_jid: "120363111111111111@g.us",
    };

    expect(getConversationKey(first)).toBe("905333333333");
    expect(getConversationKey(groupFirst)).toBe("120363000000000000@g.us");
    expect(getTenantConversationKey("now_os", first)).toBe(getTenantConversationKey("now_os", second));
    expect(getTenantConversationKey("now_os", first)).not.toBe(getTenantConversationKey("other_tenant", first));
    expect(getTenantConversationKey("now_os", first)).not.toBe(getTenantConversationKey("now_os", otherPrivate));
    expect(getTenantConversationKey("now_os", groupFirst)).toBe(getTenantConversationKey("now_os", groupSecond));
    expect(getTenantConversationKey("now_os", groupFirst)).not.toBe(getTenantConversationKey("now_os", otherGroup));
    expect(getTenantConversationKey("now_os", first)).not.toBe(getTenantConversationKey("now_os", groupFirst));
  });

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

  it("adds structured app facts from the configured knowledge fixture without production data dependency", () => {
    const previousKnowledgeDir = process.env.KNOWLEDGE_BANK_DIR;
    const tempDir = mkdtempSync(join(tmpdir(), "nowos-context-facts-"));
    try {
      writeValidKnowledgeBankFixture(tempDir);
      process.env.KNOWLEDGE_BANK_DIR = tempDir;

      const context = buildBackendContext(
        baseMessage("905333333333"),
        createTestEnv(),
        new InMemoryStore()
      );

      expect(context.structured_facts?.app_facts_source_status).toBe("loaded");
      expect(context.structured_facts?.app_facts.some((fact) => fact.app === "Layla" && fact.ios_name === "NIVI")).toBe(true);
      expect(context.structured_facts?.app_facts.some((fact) => fact.app === "Layla" && fact.capabilities.text_only === true)).toBe(true);
    } finally {
      if (previousKnowledgeDir === undefined) delete process.env.KNOWLEDGE_BANK_DIR;
      else process.env.KNOWLEDGE_BANK_DIR = previousKnowledgeDir;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
