import { describe, expect, it } from "vitest";
import { resolveCandidatePolicy } from "../intelligence/candidate/CandidatePolicyResolver.js";
import { defaultUserState } from "../storage/types.js";

describe("candidate app routing", () => {
  it("uses the approved routing matrix without removed applications", () => {
    const result = resolveCandidatePolicy({ ...defaultUserState(), gender: "kadın" }, ["Layla"]);
    expect(result.secondary_apps).toEqual(["Timo", "Linky", "Soyo"]);
    expect(result.facts.find((fact) => fact.id === "candidate_default_work_model")?.content).toContain("Layla");
    expect(result.facts.find((fact) => fact.id === "candidate_secondary_app_options")?.content).toContain("Timo");
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

  it("uses the matching published policy section for the relevant intent", () => {
    const policySections = {
      routing_matrix: "Routing matrix content.",
      application_independence: "Application independence content.",
      profile_bio_photo_rules: "Profile content.",
      memory_rules: "Memory content.",
      eligibility_rejection: "Eligibility content.",
      installation_permission: "Installation content.",
      privacy_payment_support: "Privacy content.",
      followup_closure_group_rules: "Follow-up content.",
    };
    const result = resolveCandidatePolicy({ ...defaultUserState() }, ["Layla"], [], null, "candidate_app_routing", policySections);
    expect(result.facts.find((fact) => fact.id === "policy_section_routing_matrix")?.content).toBe("Routing matrix content.");
    expect(result.facts.some((fact) => fact.id === "policy_section_profile_bio_photo_rules")).toBe(false);
  });

  it("uses profile rules for account_profile_question", () => {
    const result = resolveCandidatePolicy(
      { ...defaultUserState(), gender: "erkek" },
      ["Layla"],
      [],
      null,
      "account_profile_question",
      { ...validPolicySectionsForTest(), profile_bio_photo_rules: "Approved male account profile rule." },
    );
    expect(result.facts.find((fact) => fact.id === "policy_section_profile_bio_photo_rules")?.content)
      .toBe("Approved male account profile rule.");
    expect(result.facts.some((fact) => fact.id === "male_account_policy_boundary")).toBe(false);
  });

  it("injects owner transfer content into the relevant decision context", () => {
    const result = resolveCandidatePolicy(
      { ...defaultUserState(), gender: "erkek" },
      ["Layla"],
      [],
      null,
      "account_profile_question",
      validPolicySectionsForTest(),
      [{ section_id: "owner_rule", title: "Owner direct bilgi", content: "Erkek adaylar sadece kadin profil kuraliyla ilerler." }],
    );
    expect(result.facts.find((fact) => fact.id === "owner_transfer_owner_rule")?.content).toContain("kadin profil");
  });

  it("injects owner profile rules during work model disclosure", () => {
    const result = resolveCandidatePolicy(
      { ...defaultUserState(), gender: "erkek" },
      ["Layla"],
      [],
      null,
      "work_model_disclosure",
      validPolicySectionsForTest(),
      [{ section_id: "owner_rule", title: "Owner direct bilgi", content: "Erkek adaylar kadin profil kuraliyla ilerler." }],
    );

    expect(result.facts.find((fact) => fact.id === "owner_transfer_owner_rule")?.content)
      .toContain("kadin profil");
  });

  it("injects classified constraints without requiring an intent-specific mapping", () => {
    const result = resolveCandidatePolicy(
      defaultUserState(),
      [],
      [],
      null,
      "candidate_first_contact",
      validPolicySectionsForTest(),
      [{ section_id: "constraint_rule", title: "Owner security rule", content: "Never promise guaranteed earnings.", classification: "constraint" }],
    );

    expect(result.facts.find((fact) => fact.id === "owner_transfer_constraint_rule")?.content)
      .toContain("Never promise guaranteed earnings");
  });

  it("keeps archived owner transfer sections out of candidate context", () => {
    const result = resolveCandidatePolicy(
      defaultUserState(),
      [],
      [],
      null,
      "candidate_first_contact",
      validPolicySectionsForTest(),
      [{ section_id: "legacy_rule", title: "Legacy", content: "Old rates.", classification: "archive" }],
    );

    expect(result.facts.some((fact) => fact.id === "owner_transfer_legacy_rule")).toBe(false);
  });

  it("does not invent a policy fact when the published section is missing", () => {
    const result = resolveCandidatePolicy({ ...defaultUserState() }, ["Layla"], [], null, "candidate_app_routing", null);
    expect(result.facts.some((fact) => fact.id === "policy_section_routing_matrix")).toBe(false);
  });
});

function validPolicySectionsForTest() {
  return {
    routing_matrix: "Routing.",
    application_independence: "Independence.",
    profile_bio_photo_rules: "Profile.",
    memory_rules: "Memory.",
    eligibility_rejection: "Eligibility.",
    installation_permission: "Installation.",
    privacy_payment_support: "Privacy.",
    followup_closure_group_rules: "Follow-up.",
  };
}
