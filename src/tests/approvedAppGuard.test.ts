import { checkApprovedAppGate, SAFE_APPROVED_APP_GATE_REPLY } from "../bridge/approvedAppGuard.js";
import { buildBackendContext } from "../bridge/buildBackendContext.js";
import { InMemoryStore } from "../storage/memoryStore.js";
import { createTestEnv } from "./testDoubles.js";
import type { NormalizedIncomingMessage } from "../bridge/normalizeEvolutionMessage.js";

function message(): NormalizedIncomingMessage {
  return {
    correlation_id: "corr_guard",
    sender_id: "905333333333",
    phone_number: "905333333333",
    remote_jid: "905333333333@s.whatsapp.net",
    message_id: "msg_guard",
    message_type: "conversation",
    text: "İşi bilmeden uygulama seçemem",
    chat_type: "private",
    is_from_me: false,
    is_group: false,
    received_at: "2026-07-05T00:00:00.000Z"
  };
}

describe("approved app guard", () => {
  it("detects unapproved generic app suggestions", () => {
    const context = buildBackendContext(message(), createTestEnv(), new InMemoryStore());

    const result = checkApprovedAppGate("TikTok, Instagram, Twitch veya YouTube kullanabilirsin.", context);

    expect(result).toEqual({ ok: false, term_count: 4 });
  });

  it("allows names present in backend_context.allowed_apps", () => {
    const context = buildBackendContext(
      message(),
      createTestEnv({ approvedApps: ["Layla"] }),
      new InMemoryStore()
    );

    expect(checkApprovedAppGate("Layla üzerinden ilerleyebilirsin.", context).ok).toBe(true);
  });

  it("safe replacement reply does not contain banned app names", () => {
    expect(SAFE_APPROVED_APP_GATE_REPLY).not.toMatch(/TikTok|Instagram|Twitch|YouTube|Sozzy|Chatrace|NovaChat/i);
  });
});
