import { describe, expect, it } from "vitest";
import { resolveCandidatePolicy } from "../intelligence/candidate/CandidatePolicyResolver.js";
import { buildDecisionPrompt } from "../intelligence/conversation/ConversationDecisionEngine.js";
import { defaultUserState } from "../storage/types.js";

const sections = {
  first_contact_boundary: "Ilk temasta uygunluk bilgileri alinir.",
  source_identity_tone: "Guncel owner kaynagi kullanilir; bilgi uydurulmaz.",
  routing_matrix: "Layla, TanChat ve Timo routing matrix.",
  application_independence: "Uygulamalar birbirinden bagimsizdir.",
  profile_bio_photo_rules: "Erkek adaylarda kadin profil ve fotograf kurali.",
  memory_rules: "Daha once verilen bilgi tekrar sorulmaz.",
  eligibility_rejection: "Yas ve cinsiyet uygunluk sinirlari.",
  installation_process: "Kurulum adimlari, davet kodu ve kontrol ekranlari.",
  installation_permission: "Acik baslangic istegi gerekir.",
  installation_proof_retry: "Kurulum kaniti ve retry sonrasi owner kontrolu gerekir.",
  privacy_payment_support: "Odeme ve gizlilik sinirlari.",
  followup_closure_group_rules: "Takip ve kapanis kurallari.",
  owner_training_routing: "Egitim yonlendirmesi owner kaynagindan gelir.",
};

describe("stage-based policy context", () => {
  it("loads installation policy as a stage, without an intent-specific mapping", () => {
    const result = resolveCandidatePolicy(
      { ...defaultUserState(), current_state: "INSTALLATION_IN_PROGRESS", selected_app: "Layla" },
      ["Layla"],
      [],
      null,
      "a_new_installation_intent",
      sections,
    );

    expect(result.stage).toBe("installation");
    expect(result.policy_section_ids).toEqual(expect.arrayContaining(["installation_process", "installation_permission", "installation_proof_retry", "application_independence", "profile_bio_photo_rules", "memory_rules"]));
    expect(result.facts.map((fact) => fact.content).join(" ")).toContain("davet kodu");
    expect(result.facts.map((fact) => fact.id)).not.toContain("work_model_acceptance_required");
    expect(result.facts.map((fact) => fact.id)).not.toContain("candidate_secondary_app_options");
  });

  it("loads all intake constraints and keeps prompt text auditable", () => {
    const result = resolveCandidatePolicy({ ...defaultUserState(), current_state: "NEW_LEAD" }, [], [], null, "unseen_intent", sections);
    const context = {
      derived_state: {
        policy_stage: result.stage,
        policy_section_ids: result.policy_section_ids,
        policy_context_token_estimate: result.policy_context_token_estimate,
        dialogue_phase: "NEW_LEAD",
        intake_complete: false,
        eligibility_status: "unresolved",
        missing_stage_sections: result.missing_stage_sections,
      },
      canonical_policy_facts: result.facts,
      latest_message: { inferred_intent: "unseen_intent" },
      candidate_state: { age: null, gender: null, daily_hours: null, work_model_acceptance: null, selected_app: null, phone_type: null },
      recent_messages: [],
    } as any;
    const prompt = buildDecisionPrompt(context);
    expect(result.stage).toBe("intake");
    expect(result.policy_section_ids).toEqual(expect.arrayContaining(["eligibility_rejection", "profile_bio_photo_rules", "memory_rules"]));
    expect(result.policy_context_token_estimate).toBeLessThanOrEqual(2000);
    for (const fact of result.facts) expect(prompt).toContain(fact.content);
  });
});
