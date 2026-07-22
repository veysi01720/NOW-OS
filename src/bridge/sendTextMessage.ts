import type { EnvConfig } from "../config/env.js";
import { redactSecrets } from "../utils/redaction.js";
import type { NormalizedIncomingMessage } from "./normalizeEvolutionMessage.js";

export interface SendTextInput {
  message: NormalizedIncomingMessage;
  text: string;
}

export interface EvolutionSender {
  sendText(input: SendTextInput): Promise<void>;
}

export class EvolutionSendTextError extends Error {
  constructor(
    message: string,
    public readonly httpStatus?: number
  ) {
    super(message);
    this.name = "EvolutionSendTextError";
  }
}

function compactJidToDigits(jid: string): string {
  return jid.split("@")[0]?.split(":")[0]?.replace(/\D/g, "") ?? "";
}

function isWhatsAppJid(value: string): boolean {
  return /@(s\.whatsapp\.net|g\.us|lid)$/u.test(value);
}

export function resolveEvolutionSendTextRecipient(message: NormalizedIncomingMessage): string {
  if (message.chat_type === "group") {
    return message.remote_jid;
  }

  const remoteJid = message.remote_jid.trim();
  const phoneNumber = message.phone_number.trim();
  const phoneWasDerivedFromRemoteLid = remoteJid.endsWith("@lid") && phoneNumber === compactJidToDigits(remoteJid);

  if (phoneWasDerivedFromRemoteLid || (phoneNumber === "" && isWhatsAppJid(remoteJid))) {
    return remoteJid;
  }

  return phoneNumber;
}

export class EvolutionApiSender implements EvolutionSender {
  constructor(private readonly env: EnvConfig) {}

  async sendText(input: SendTextInput): Promise<void> {
    const url = new URL(
      `/message/sendText/${encodeURIComponent(this.env.evolutionInstance)}`,
      this.env.evolutionApiBaseUrl
    );
    const number = resolveEvolutionSendTextRecipient(input.message);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: this.env.evolutionApiKey
      },
      body: JSON.stringify({
        number,
        text: input.text
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new EvolutionSendTextError(
        `Evolution sendText failed with ${response.status}: ${redactSecrets(body.slice(0, 300))}`,
        response.status
      );
    }
  }
}
