import { describe, expect, it } from "vitest";
import { matchesNormalizedHint, normalizeUserText } from "../utils/textNormalization.js";
import { detectApprovedApp, detectModelAcceptance, detectPhoneType } from "../bridge/candidateIntakeStateMachine.js";

describe("natural-language fast hints", () => {
  it("normalizes Turkish, punctuation, emoji and mojibake safely", () => {
    expect(normalizeUserText("GENEL İŞ MODELİ!!!")).toBe("genel is modeli");
    expect(normalizeUserText("uygun 👍")).toBe("uygun");
  });

  it.each(["uygub", "uygundur", "tmm", "olur", "evt", "evet uygun", "ok", "tamam!!!"])('detects acceptance hint: %s', (value) => {
    expect(detectModelAcceptance(value)).toBe("accepted");
  });

  it.each(["andorid", "androit", "android", "samsung"])('detects Android hint: %s', (value) => {
    expect(detectPhoneType(value).phone_type).toBe("android");
  });

  it.each(["iphon", "ayfon", "iphone"])('detects iOS hint: %s', (value) => {
    expect(detectPhoneType(value).phone_type).toBe("ios");
  });

  it.each(["layla", "Layla", "LAYLA", "leyla"])('detects app hint: %s', (value) => {
    expect(detectApprovedApp(value, ["Layla"])).toBe("Layla");
  });

  it.each(["erkegim", "erkek", "bay"])('detects gender hint: %s', (value) => {
    expect(matchesNormalizedHint(value, ["erkek", "erkegim", "bay"])).toBe(true);
  });

  it("does not blur opposites", () => {
    expect(detectModelAcceptance("olmaz")).toBe("rejected");
    expect(detectModelAcceptance("reddet")).toBe("rejected");
    expect(detectModelAcceptance("hayir, uygun degil")).toBe("rejected");
  });

  it("does not treat clarification as work-model acceptance", () => {
    expect(detectModelAcceptance("Tam anlamadim")).toBeNull();
    expect(detectModelAcceptance("tam anlamadım")).toBeNull();
    expect(detectModelAcceptance("kamerasiz olur mu")).toBeNull();
  });
});
