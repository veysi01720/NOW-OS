import { describe, expect, it } from "vitest";
import { getDefaultBehaviorProfile } from "../behavior/behaviorProfile.js";

describe("default behavior profile", () => {
  it("contains behavior rules but no operational facts", () => {
    const profile = getDefaultBehaviorProfile();
    const serialized = JSON.stringify(profile).toLowerCase();

    expect(profile.tone).toBe("natural_supportive");
    expect(profile.askOneQuestionAtATime).toBe(true);
    expect(profile.avoidRepeatingKnownInformation).toBe(true);
    expect(serialized).not.toContain("m9w5b8");
    expect(serialized).not.toContain("8unhawufc");
    expect(serialized).not.toContain("http");
    expect(serialized).not.toContain("payment");
  });

  it("defines prohibited behaviors for safety and naturalness", () => {
    const profile = getDefaultBehaviorProfile();

    expect(profile.prohibitedBehaviors).toEqual(expect.arrayContaining([
      "bilgi_uydurma",
      "riskli_garanti_verme",
      "internal_note_gosterme",
      "raw_backend_metadata_gosterme",
      "her_cevapta_uzun_egitim_metni_verme",
      "her_cevapta_selamlama_kullanma",
      "ayni_anda_cok_soru_sorma",
    ]));
  });
});
