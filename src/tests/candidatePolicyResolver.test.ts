import { describe, expect, it } from "vitest";
import { resolveCandidatePolicy } from "../intelligence/candidate/CandidatePolicyResolver.js";
import { defaultUserState } from "../storage/types.js";

describe("candidate app routing", () => {
  it("does not create an application fact from an environment-only list", () => {
    const result = resolveCandidatePolicy({ ...defaultUserState(), gender: "kadın" }, ["Layla"]);
    expect(result.secondary_apps).toEqual([]);
    expect(result.facts.find((fact) => fact.id === "candidate_default_work_model")).toBeUndefined();
    expect(result.facts.find((fact) => fact.id === "candidate_secondary_app_options")).toBeUndefined();
  });

  it("does not invent an app when structured facts are unavailable", () => {
    const result = resolveCandidatePolicy({ ...defaultUserState() }, []);
    expect(result.facts.some((fact) => fact.id === "candidate_default_work_model")).toBe(false);
  });

  it("derives the candidate app list from owner-approved structured facts", () => {
    const facts = ["Layla", "TanChat", "Linky"].map((app) => ({
      app,
      android_name: app,
      ios_name: app,
      invite_code: null,
      agency_bind_code: null,
      agency_code: null,
      official_url: null,
      status: "owner_approved",
      aliases: [],
      capabilities: { text_only: false, video_required: false },
    }));
    const result = resolveCandidatePolicy({ ...defaultUserState() }, [], facts);
    expect(result.secondary_apps).toEqual(["Layla", "TanChat", "Linky"]);
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
    const policySections = { ...validPolicySectionsForTest(), routing_matrix: "Routing matrix content." };
    const result = resolveCandidatePolicy({ ...defaultUserState(), current_state: "WAITING_FOR_APP" }, ["Layla"], [], null, "candidate_app_routing", policySections);
    expect(result.facts.find((fact) => fact.id === "policy_section_routing_matrix")?.content).toContain("Routing matrix content.");
    expect(result.facts.some((fact) => fact.id === "policy_section_profile_bio_photo_rules")).toBe(true);
  });

  it("projects the selected app's published installation facts into the stage context", () => {
    const result = resolveCandidatePolicy(
      { ...defaultUserState(), current_state: "INSTALLATION_IN_PROGRESS", selected_app: "Layla" },
      ["Layla"],
      [{
        app: "Layla",
        android_name: "Layla",
        ios_name: "NIVI",
        invite_code: "G-8UNHAWUFC",
        agency_bind_code: null,
        agency_code: null,
        official_url: "https://example.test/layla",
        status: "owner_approved",
        aliases: ["Leyla"],
        capabilities: { text_only: true, video_required: false },
      }],
      null,
      "installation_question",
      validPolicySectionsForTest(),
    );

    const fact = result.facts.find((item) => item.id === "structured_app_fact_layla");
    expect(fact?.content).toContain("https://example.test/layla");
    expect(fact?.content).toContain("G-8UNHAWUFC");
    expect(fact?.content).toContain("NIVI");
  });

  it("projects the approved app catalog during app selection without requiring intent mappings", () => {
    const result = resolveCandidatePolicy(
      { ...defaultUserState(), current_state: "WAITING_FOR_APP" },
      [],
      ["Layla", "TanChat"].map((app) => ({
        app,
        android_name: app,
        ios_name: app,
        invite_code: null,
        agency_bind_code: null,
        agency_code: null,
        official_url: null,
        status: "owner_approved",
        aliases: [],
        capabilities: { text_only: false, video_required: false },
      })),
      null,
      "unseen_app_selection_intent",
      validPolicySectionsForTest(),
    );

    expect(result.facts.some((item) => item.id === "structured_app_fact_layla")).toBe(true);
    expect(result.facts.some((item) => item.id === "structured_app_fact_tanchat")).toBe(true);
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

  it("carries published profile rules into work model disclosure", () => {
    const result = resolveCandidatePolicy(
      { ...defaultUserState(), gender: "erkek" },
      ["Layla"],
      [],
      null,
      "provide_work_model_disclosure",
      { ...validPolicySectionsForTest(), profile_bio_photo_rules: "Erkek adaylar kadin profil ve fotograf modeliyle ilerler." },
    );
    expect(result.facts.find((fact) => fact.id === "policy_section_profile_bio_photo_rules")?.content)
      .toContain("kadin profil");
  });

  it("does not expose the post-install history question during app selection", () => {
    const result = resolveCandidatePolicy(
      { ...defaultUserState(), current_state: "WAITING_FOR_APP" },
      ["Layla"],
      [{ app: "Layla", android_name: "Layla", ios_name: "NIVI", invite_code: null, agency_bind_code: null, agency_code: null, official_url: null, status: "owner_approved", aliases: [], capabilities: { text_only: true, video_required: false } }],
      null,
      "ask_selected_app",
      { ...validPolicySectionsForTest(), routing_matrix: "Layla genellikle onceliklidir.\n- Kurulum sonrasi onceki uygulamalar sorulur." },
    );
    const routing = result.facts.find((fact) => fact.id === "policy_section_routing_matrix")?.content ?? "";
    expect(routing).toContain("tek bir uygun uygulama oner");
    expect(routing).not.toContain("onceki uygulamalar sorulur");
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

  it("includes memory rules in every candidate intent context", () => {
    const result = resolveCandidatePolicy(
      defaultUserState(),
      [],
      [],
      null,
      "work_model_disclosure",
      validPolicySectionsForTest(),
    );

    expect(result.facts.find((fact) => fact.id === "policy_section_memory_rules")?.content)
      .toBe("Memory.");
  });

  it("does not invent a policy fact when the published section is missing", () => {
    const result = resolveCandidatePolicy({ ...defaultUserState() }, ["Layla"], [], null, "candidate_app_routing", null);
    expect(result.facts.some((fact) => fact.id === "policy_section_routing_matrix")).toBe(false);
  });
});

function validPolicySectionsForTest() {
  return {
    first_contact_boundary: "First contact.",
    source_identity_tone: "Source identity.",
    routing_matrix: "Routing.",
    application_independence: "Independence.",
    profile_bio_photo_rules: "Profile.",
    memory_rules: "Memory.",
    eligibility_rejection: "Eligibility.",
    installation_process: "Installation process.",
    installation_permission: "Installation.",
    installation_proof_retry: "Installation proof retry.",
    privacy_payment_support: "Privacy.",
    followup_closure_group_rules: "Follow-up.",
    owner_training_routing: "Owner training routing.",
  };
}
