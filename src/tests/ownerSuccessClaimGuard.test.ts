import { describe, expect, it } from "vitest";
import { guardUnbackedOwnerSuccessClaim } from "../bridge/ownerSuccessClaimGuard.js";

describe("owner success claim guard", () => {
  it("blocks definitive model success claims without a backend execution result", () => {
    const result = guardUnbackedOwnerSuccessClaim({
      reply: "Bilgi senkronizasyonu tamamlandı.",
      senderRole: "owner",
      executionSucceeded: false,
    });
    expect(result.blocked).toBe(true);
    expect(result.reply).toContain("Komut formatı tanınmadı");
  });

  it("allows a definitive claim only when the backend reports success", () => {
    const result = guardUnbackedOwnerSuccessClaim({
      reply: "Bilgi senkronizasyonu tamamlandı.",
      senderRole: "owner",
      executionSucceeded: true,
    });
    expect(result.blocked).toBe(false);
    expect(result.reply).toContain("tamamlandı");
  });

  it("does not rewrite candidate-facing replies", () => {
    const result = guardUnbackedOwnerSuccessClaim({
      reply: "İşlem tamamlandı.",
      senderRole: "candidate",
      executionSucceeded: false,
    });
    expect(result.blocked).toBe(false);
  });

  it("blocks the same unbacked claim for a legacy/general owner reply", () => {
    const result = guardUnbackedOwnerSuccessClaim({
      reply: "Bilgi senkronizasyonu tamamlandi.",
      senderRole: "owner",
      executionSucceeded: false,
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("OWNER_SUCCESS_CLAIM_WITHOUT_EXECUTION_RESULT");
  });

  it("allows a deterministic command claim only after execution succeeds", () => {
    const result = guardUnbackedOwnerSuccessClaim({
      reply: "Bilgi senkronizasyonu tamamlandi.",
      senderRole: "owner",
      executionSucceeded: true,
    });
    expect(result.blocked).toBe(false);
  });
});
