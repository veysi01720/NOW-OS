const DEFINITIVE_SUCCESS_CLAIM = /(?:tamamlandı|tamamlandi|başarıyla|basariyla|aktif edildi|uygulandı|uygulandi|yayınlandı|yayinlandi|iletildi|gönderildi|gonderildi|onaylandı|onaylandi|senkronize edildi|işlem yapıldı|islem yapildi)/iu;

export const UNKNOWN_OWNER_COMMAND_REPLY =
  "Bu işlemin tamamlandığını doğrulayan bir kayıt yok; hiçbir değişikliği başarılı saymadım.";

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
