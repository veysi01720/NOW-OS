const DEFINITIVE_SUCCESS_CLAIM = /(?:tamamlandı|tamamlandi|başarıyla aktarıldı|basariyla aktarildi|senkronizasyon tamamlandı|senkronizasyon tamamlandi|başarıyla senkronize edildi|basariyla senkronize edildi|işlem tamamlandı|islem tamamlandi)/iu;

export const UNKNOWN_OWNER_COMMAND_REPLY =
  "Komut formatı tanınmadı. Kullanılabilir format: #komut onaylıları bilgi bankasına aktar";

export function guardUnbackedOwnerSuccessClaim(input: {
  reply: string;
  senderRole: string;
  executionSucceeded: boolean;
}): { reply: string; blocked: boolean; reason?: string } {
  const privileged = input.senderRole === "owner" || input.senderRole === "manager";
  if (!privileged || input.executionSucceeded || !DEFINITIVE_SUCCESS_CLAIM.test(input.reply)) {
    return { reply: input.reply, blocked: false };
  }
  return {
    reply: UNKNOWN_OWNER_COMMAND_REPLY,
    blocked: true,
    reason: "OWNER_SUCCESS_CLAIM_WITHOUT_EXECUTION_RESULT"
  };
}
