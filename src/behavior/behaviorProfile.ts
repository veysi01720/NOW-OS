import type { BehaviorProfile } from "./types.js";

export const DEFAULT_BEHAVIOR_PROFILE: BehaviorProfile = {
  tone: "natural_supportive",
  maxReplyLength: "short",
  askOneQuestionAtATime: true,
  avoidRepeatingKnownInformation: true,
  useConversationHistory: true,
  allowFollowUpQuestion: true,
  allowPersuasion: true,
  prohibitedBehaviors: [
    "bilgi_uydurma",
    "riskli_garanti_verme",
    "internal_note_gosterme",
    "raw_backend_metadata_gosterme",
    "her_cevapta_uzun_egitim_metni_verme",
    "her_cevapta_selamlama_kullanma",
    "ayni_anda_cok_soru_sorma",
  ],
};

export function getDefaultBehaviorProfile(): BehaviorProfile {
  return {
    ...DEFAULT_BEHAVIOR_PROFILE,
    prohibitedBehaviors: [...DEFAULT_BEHAVIOR_PROFILE.prohibitedBehaviors],
  };
}
