import type { EnvConfig } from "../config/env.js";
import { resolveSenderRole, type SenderRole } from "../config/roles.js";
import type { NormalizedIncomingMessage } from "./normalizeEvolutionMessage.js";

export interface AuthorityContext {
  sender_role: SenderRole;
  chat_type: "private" | "group";
  authority_source: "backend_whitelist";
  whitelist_match: boolean;
  privileged: boolean;
}

export function resolveAuthorityContext(
  message: NormalizedIncomingMessage,
  env: Pick<EnvConfig, "ownerPhoneNumbers" | "managerPhoneNumbers">,
): AuthorityContext {
  const senderRole = resolveSenderRole(
    message.phone_number,
    {
      ownerPhoneNumbers: env.ownerPhoneNumbers,
      managerPhoneNumbers: env.managerPhoneNumbers,
    },
    { chatType: message.chat_type },
  );
  const privileged = senderRole === "owner" || senderRole === "manager";

  return {
    sender_role: senderRole,
    chat_type: message.chat_type,
    authority_source: "backend_whitelist",
    whitelist_match: privileged,
    privileged,
  };
}
