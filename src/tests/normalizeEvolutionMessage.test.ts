import { classifyEvolutionPayloadShape, normalizeEvolutionMessage } from "../bridge/normalizeEvolutionMessage.js";

describe("normalizeEvolutionMessage", () => {
  it("normalizes a private Evolution message", () => {
    const message = normalizeEvolutionMessage({
      event: "messages.upsert",
      data: {
        key: {
          remoteJid: "905333333333@s.whatsapp.net",
          fromMe: false,
          id: "msg_1"
        },
        pushName: "Ada",
        messageType: "conversation",
        messageTimestamp: 1_756_000_000,
        message: {
          conversation: "Merhaba"
        }
      }
    });

    expect(message.phone_number).toBe("905333333333");
    expect(message.sender_id).toBe("905333333333");
    expect(message.chat_type).toBe("private");
    expect(message.is_group).toBe(false);
    expect(message.text).toBe("Merhaba");
    expect(message.push_name).toBe("Ada");
  });

  it("normalizes a group message using participant as sender", () => {
    const message = normalizeEvolutionMessage({
      data: {
        key: {
          remoteJid: "120363000000000000@g.us",
          participant: "905444444444@s.whatsapp.net",
          fromMe: false,
          id: "msg_group"
        },
        message: {
          extendedTextMessage: {
            text: "Grup mesaji"
          }
        }
      }
    });

    expect(message.chat_type).toBe("group");
    expect(message.is_group).toBe(true);
    expect(message.phone_number).toBe("905444444444");
    expect(message.remote_jid).toBe("120363000000000000@g.us");
  });

  it("preserves fromMe and empty text for handler filtering", () => {
    const message = normalizeEvolutionMessage({
      data: {
        key: {
          remoteJid: "905333333333@s.whatsapp.net",
          fromMe: true,
          id: "msg_2"
        },
        message: {}
      }
    });

    expect(message.is_from_me).toBe(true);
    expect(message.text).toBe("");
  });

  it("normalizes body.data.messages[0] payloads", () => {
    const message = normalizeEvolutionMessage({
      data: {
        messages: [
          {
            key: {
              remoteJid: "905555555555@s.whatsapp.net",
              fromMe: false,
              id: "msg_array"
            },
            pushName: "Mina",
            messageType: "conversation",
            messageTimestamp: 1_756_000_100,
            message: {
              conversation: "Array format"
            }
          }
        ]
      }
    });

    expect(message.phone_number).toBe("905555555555");
    expect(message.message_id).toBe("msg_array");
    expect(message.message_type).toBe("conversation");
    expect(message.text).toBe("Array format");
    expect(message.push_name).toBe("Mina");
  });

  it("normalizes root-level message.conversation payloads", () => {
    const message = normalizeEvolutionMessage({
      event: "messages.upsert",
      key: {
        remoteJid: "905333333333@s.whatsapp.net",
        fromMe: false,
        id: "msg_root"
      },
      messageType: "conversation",
      message: {
        conversation: "SMOKE3D-TEXT-PATH Layla iPhone adi ne?"
      }
    });

    expect(message.message_id).toBe("msg_root");
    expect(message.text).toBe("SMOKE3D-TEXT-PATH Layla iPhone adi ne?");
  });

  it("classifies empty private webhook shape without raw text", () => {
    const payload = {
      event: "messages.upsert",
      data: {
        key: {
          remoteJid: "905333333333@s.whatsapp.net",
          fromMe: false,
          id: "msg_empty"
        },
        messageType: "conversation",
        message: {}
      }
    };
    const normalized = normalizeEvolutionMessage(payload);
    const shape = classifyEvolutionPayloadShape(payload, normalized);

    expect(shape.event_name).toBe("messages.upsert");
    expect(shape.has_data).toBe(true);
    expect(shape.has_key).toBe(true);
    expect(shape.from_me).toBe(false);
    expect(shape.is_group).toBe(false);
    expect(shape.normalized_text_length).toBe(0);
    expect(shape.normalized_text_hash).toBeNull();
    expect(shape.marker_detected).toBe(false);
    expect(shape.event_class).toBe("private_message_empty_payload");
    expect(shape.ignored_reason).toBe("private_message_empty_payload");
  });

  it("classifies marker text without logging raw text", () => {
    const payload = {
      data: {
        key: {
          remoteJid: "905333333333@s.whatsapp.net",
          fromMe: false,
          id: "msg_marker"
        },
        message: {
          extendedTextMessage: {
            text: "SMOKE3D-TEXT-PATH Layla iPhone adi ne?"
          }
        }
      }
    };
    const normalized = normalizeEvolutionMessage(payload);
    const shape = classifyEvolutionPayloadShape(payload, normalized);

    expect(shape.normalized_text_length).toBeGreaterThan(0);
    expect(shape.normalized_text_hash).toHaveLength(16);
    expect(shape.marker_detected).toBe(true);
    expect(shape.possible_text_paths_present).toContain("data.message.extendedTextMessage.text");
    expect(shape.event_class).toBe("text_message");
  });
});
