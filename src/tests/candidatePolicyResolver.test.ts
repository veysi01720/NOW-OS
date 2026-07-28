import { describe, expect, it } from "vitest";
import { resolveCandidatePolicy } from "../intelligence/candidate/CandidatePolicyResolver.js";
import { defaultUserState } from "../storage/types.js";

describe("candidate app routing", () => {
  it("keeps Layla as default while exposing Chatta only as a secondary option", () => {
    const result = resolveCandidatePolicy({ ...defaultUserState(), gender: "kadın" }, ["Layla"]);
    expect(result.secondary_apps).toEqual(["Chatta"]);
    expect(result.facts.find((fact) => fact.id === "candidate_default_work_model")?.content).toContain("Layla");
    expect(result.facts.find((fact) => fact.id === "candidate_secondary_app_options")?.content).toContain("Chatta");
  });

  it("uses general_work_model for ask_job_definition before app-specific routing facts", () => {
    const result = resolveCandidatePolicy(
      { ...defaultUserState(), gender: "kadÄ±n" },
      ["Layla", "Soyo"],
      [{
        app: "Layla",
        android_name: "Layla",
        ios_name: "NIVI",
        invite_code: null,
        agency_bind_code: null,
        agency_code: null,
        official_url: null,
        status: "owner_approved",
        aliases: [],
        capabilities: { text_only: true, video_required: false },
      }],
      {
        app_independent: true,
        source_section: "Genel İş Modeli",
        summary: "Genel mesajlaÅŸma temelli iÅŸ akÄ±ÅŸÄ±.",
        workflow: "Kurulum sonrasÄ± aday mesajlara yazÄ±lÄ± yanÄ±t verir.",
        earnings_policy: "SonuÃ§lar kurallara ve performansa baÄŸlÄ±dÄ±r; garanti verilmez.",
        payment_policy: "Ã–deme resmi sÃ¼rece baÄŸlÄ±dÄ±r.",
        setup_boundary: "Uygulama-Ã¶zel kurulum ayrÄ±ca doÄŸrulanÄ±r.",
      },
      "ask_job_definition",
    );

    expect(result.facts.find((fact) => fact.id === "general_work_model")?.content).toContain("Genel mesajlaÅŸma");
    expect(result.facts.some((fact) => fact.id === "structured_app_job_definition_layla")).toBe(false);
    expect(result.facts.some((fact) => fact.id === "candidate_default_work_model")).toBe(false);
  });
});
