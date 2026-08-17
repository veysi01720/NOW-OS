import { describe, expect, it } from "vitest";
import { buildAssistantRunContent } from "../assistant/assistantRun.js";
import type { BackendContextPayloadV1 } from "../contracts/backendContextPayload.js";
import { applyOwnerTone, ownerAssistantToneGuidanceLines } from "../bridge/ownerTone.js";
import { defaultUserState } from "../storage/types.js";

function backendContext(role: "owner" | "manager" | "candidate"): BackendContextPayloadV1 {
  return {
    backend_context_version: "1.0",
    correlation_id: `corr_${role}`,
    sender_role: role,
    chat_type: "private",
    sender: { sender_id: "905111111111", phone_number: "905111111111" },
    chat: {
      remote_jid: "905111111111@s.whatsapp.net",
      message_id: `msg_${role}`,
      message_type: "conversation",
      is_from_me: false,
      is_group: false,
    },
    allowed_apps: [],
    state: defaultUserState(),
    memory: {
      conversation_summary: "",
      last_5_user_messages: [],
      last_5_bot_replies: [],
      last_10_messages: [],
    },
    versions: {
      assistant_response_contract_version: "1.0",
      system_prompt_version: "1.0.0",
      knowledge_base_version: "test",
      backend_context_version: "1.0",
      state_machine_version: "1.0",
    },
    user_message: { text: "durum ne", received_at: "2026-08-18T00:00:00.000Z" },
  };
}

describe("owner-facing tone", () => {
  it("addresses the owner as Arda without leaking that name to manager copies", () => {
    const base = "Adaydan net bilgi isteyen bir soru geldi.";

    expect(applyOwnerTone(base, { context: "owner_answer_required", recipientRole: "owner", forceName: true }))
      .toMatch(/^Arda,/u);
    expect(applyOwnerTone(base, { context: "owner_answer_required", recipientRole: "manager", forceName: true }))
      .not.toContain("Arda");
  });

  it("keeps Arda as a natural interval instead of forcing every owner message", () => {
    const cold = applyOwnerTone("Kisa durum hazir.", { context: "owner_command", seed: "a" });
    const addressed = applyOwnerTone("Kisa durum hazir.", { context: "owner_command", seed: "e" });

    expect(cold).not.toContain("Arda");
    expect(addressed).toContain("Arda");
  });

  it("only adds an operational observation when one is supplied", () => {
    expect(applyOwnerTone("Liste hazir.", { forceName: true })).not.toContain("Kisa izlenim");
    expect(applyOwnerTone("Liste hazir.", { forceName: true, observation: "Aday iki kez farkli bilgi verdi." }))
      .toContain("Kisa izlenim: Aday iki kez farkli bilgi verdi.");
  });

  it("adds owner personality guidance only to owner model runs", () => {
    const ownerPrompt = buildAssistantRunContent(backendContext("owner"));
    const managerPrompt = buildAssistantRunContent(backendContext("manager"));
    const candidatePrompt = buildAssistantRunContent(backendContext("candidate"));

    expect(ownerPrompt).toContain("The owner is Arda");
    expect(ownerPrompt).toContain("not in every message");
    expect(managerPrompt).not.toContain("The owner is Arda");
    expect(candidatePrompt).not.toContain("The owner is Arda");
    expect(ownerAssistantToneGuidanceLines().join(" ")).toContain("only to owner-facing replies");
  });
});
