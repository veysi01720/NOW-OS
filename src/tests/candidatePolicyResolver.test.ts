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
});
