import { describe, expect, it } from "vitest";
import { inferKnowledgeSectionClassification, inferKnowledgeSectionUsage, normalizeKnowledgeUsage } from "../intelligence/candidate/knowledgeSectionUsage.js";

describe("knowledge section lifecycle scoping", () => {
  it("keeps lifecycle training guidance out of pre-training candidate context", () => {
    const input = {
      title: "25. EĞİTİM",
      content: "Eğitim ücretsizdir. Tek oturum genelde yaklaşık bir saat sürer; aday anlamazsa destek devam eder.",
    };
    const classification = inferKnowledgeSectionClassification(input);

    expect(classification).toBe("information");
    expect(inferKnowledgeSectionUsage({ ...input, classification })).toEqual({
      candidate_context: true,
      stages: ["training"],
      topic: "post_training_support",
    });
  });

  it("re-scopes historic training records that were stored as all-stage constraints", () => {
    const input = {
      title: "26. EĞİTİMCİ / OWNER YÖNLENDİRMESİ",
      content: "Kurulum tamamlandıktan sonra ilgili eğitim kişisine yönlendirme yapılabilir.",
      classification: "information",
    } as const;

    expect(normalizeKnowledgeUsage({
      candidate_context: true,
      stages: ["intake", "app_selection", "installation", "training"],
      topic: "safety_constraint",
    }, input)).toEqual({
      candidate_context: true,
      stages: ["training"],
      topic: "post_training_support",
    });
  });

  it("keeps training banks fully isolated from candidate context", () => {
    const input = { title: "Eğitim mesaj bankası", content: "SayHi için örnek mesajlar." };
    const classification = inferKnowledgeSectionClassification(input);

    expect(classification).toBe("training");
    expect(inferKnowledgeSectionUsage({ ...input, classification })).toEqual({
      candidate_context: false,
      stages: [],
      topic: "training",
    });
  });
});
