import { logger } from "../observability/logger.js";

export type SenderRole = "owner" | "manager" | "candidate" | "publisher" | "support" | "unknown";

export interface RoleWhitelist {
  ownerPhoneNumbers: string[];
  managerPhoneNumbers: string[];
}

export interface ResolveSenderRoleOptions {
  chatType: "private" | "group";
}

export function normalizePhoneNumber(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) {
    digits = `90${digits.slice(1)}`;
  }
  if (digits.length === 10 && digits.startsWith("5")) {
    digits = `90${digits}`;
  }
  return digits;
}

export function resolveSenderRole(
  phoneNumber: string,
  whitelist: RoleWhitelist,
  options: ResolveSenderRoleOptions
): SenderRole {
  const normalized = normalizePhoneNumber(phoneNumber);
  const ownerSet = new Set(whitelist.ownerPhoneNumbers.map(normalizePhoneNumber));
  const managerSet = new Set(whitelist.managerPhoneNumbers.map(normalizePhoneNumber));

  if (ownerSet.has(normalized)) {
    if (managerSet.has(normalized)) {
      logger.warn({
        event_type: "OWNER_MANAGER_ROLE_COLLISION",
        precedence_applied: "owner",
        sender_masked: normalized.length >= 3 ? `${normalized.slice(0, 3)}***` : "***"
      });
    }
    return "owner";
  }

  if (managerSet.has(normalized)) {
    return "manager";
  }

  if (normalized !== "" && options.chatType === "private") {
    return "candidate";
  }

  return "unknown";
}
