import { afterEach, describe, expect, it, vi } from "vitest";
import type { EnvConfig } from "../config/env.js";
import type { NormalizedIncomingMessage } from "../bridge/normalizeEvolutionMessage.js";
import { EvolutionApiSender, resolveEvolutionSendTextRecipient } from "../bridge/sendTextMessage.js";

const baseMessage: NormalizedIncomingMessage = {
  correlation_id: "corr_send_text",
  sender_id: "905333333333",
  phone_number: "905333333333",
  remote_jid: "905333333333@s.whatsapp.net",
  message_id: "msg_send_text",
  message_type: "text",
  text: "Selam",
  chat_type: "private",
  is_from_me: false,
  is_group: false,
  received_at: "2026-07-22T00:00:00.000Z",
};

const env = {
  evolutionApiBaseUrl: "http://evolution.test",
  evolutionInstance: "nowakademi_bot",
  evolutionApiKey: "test-key",
} as EnvConfig;

function message(overrides: Partial<NormalizedIncomingMessage>): NormalizedIncomingMessage {
  return { ...baseMessage, ...overrides };
}

describe("sendTextMessage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps regular private WhatsApp replies addressed by phone number", () => {
    expect(resolveEvolutionSendTextRecipient(baseMessage)).toBe("905333333333");
  });

  it("keeps group replies addressed by group JID", () => {
    expect(resolveEvolutionSendTextRecipient(message({
      chat_type: "group",
      is_group: true,
      remote_jid: "120363000000000000@g.us",
      phone_number: "905444444444",
    }))).toBe("120363000000000000@g.us");
  });

  it("uses the phone number when a private LID message also has a canonical phone alias", () => {
    expect(resolveEvolutionSendTextRecipient(message({
      remote_jid: "111111111111111@lid",
      phone_number: "905333333333",
    }))).toBe("905333333333");
  });

  it("uses the full LID JID instead of a fake numeric phone when no phone alias exists", () => {
    expect(resolveEvolutionSendTextRecipient(message({
      sender_id: "111111111111111",
      phone_number: "111111111111111",
      remote_jid: "111111111111111@lid",
    }))).toBe("111111111111111@lid");
  });

  it("posts the resolved LID JID to Evolution sendText", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await new EvolutionApiSender(env).sendText({
      message: message({
        sender_id: "111111111111111",
        phone_number: "111111111111111",
        remote_jid: "111111111111111@lid",
      }),
      text: "Merhaba",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0] as unknown as [unknown, { body?: BodyInit }] | undefined;
    const options = call?.[1];
    expect(JSON.parse(String(options?.body))).toEqual({
      number: "111111111111111@lid",
      text: "Merhaba",
    });
  });
});
