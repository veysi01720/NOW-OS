import { describe, expect, it } from "vitest";
import {
  CONVERSATION_DECISION_V3_ACTIONS,
  CONVERSATION_DECISION_V3_EVIDENCE_SOURCES,
  CONVERSATION_DECISION_V3_NEXT_ACTIONS,
  CONVERSATION_DECISION_V3_SCHEMA,
  CONVERSATION_DECISION_V3_SCHEMA_VERSION,
  CONVERSATION_DECISION_V3_STATE_PATCH_FIELDS,
} from "../../intelligence/conversation/ConversationDecisionV3Schema.js";
import { createModelAdapter } from "../../modelAdapter/modelAdapterFactory.js";
import { AssistantAdapter } from "../../modelAdapter/AssistantAdapter.js";
import { FakeAssistantClient } from "../testDoubles.js";
import { InMemoryThreadStore } from "../../storage/threadStore.js";

describe("Package 08 ConversationDecision V3 contract completion", () => {
  it("publishes the additive V3.1 contract with distinct action namespaces", () => {
    expect(CONVERSATION_DECISION_V3_SCHEMA_VERSION).toBe("3.1");
    expect(CONVERSATION_DECISION_V3_ACTIONS).toContain("record_work_preference");
    expect(CONVERSATION_DECISION_V3_ACTIONS).not.toContain("reply_only");
    expect(CONVERSATION_DECISION_V3_ACTIONS).not.toContain("update_candidate_state");
    expect(CONVERSATION_DECISION_V3_NEXT_ACTIONS).toContain("reply_only");
    expect(CONVERSATION_DECISION_V3_NEXT_ACTIONS).toContain("update_candidate_state");
  });

  it("completes preference patch fields and sanitized evidence vocabulary", () => {
    expect(CONVERSATION_DECISION_V3_STATE_PATCH_FIELDS).toEqual(expect.arrayContaining([
      "preferred_work_mode",
      "video_allowed",
    ]));
    expect(CONVERSATION_DECISION_V3_EVIDENCE_SOURCES).toEqual([
      "current_message",
      "existing_state",
      "canonical_policy_fact",
      "reply_content",
    ]);
    expect(JSON.stringify(CONVERSATION_DECISION_V3_SCHEMA)).not.toMatch(/raw_user_text|message_text|phone_number|remote_jid/);
  });

  it("keeps the primary model factory on the existing Assistant adapter", () => {
    const adapter = createModelAdapter({
      assistantClient: new FakeAssistantClient(),
      threadStore: new InMemoryThreadStore(),
    });

    expect(adapter).toBeInstanceOf(AssistantAdapter);
    expect(adapter.provider).toBe("openai_assistant");
  });
});
