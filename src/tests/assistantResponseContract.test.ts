import {
  ASSISTANT_SAFE_FALLBACK_REPLY,
  parseAssistantResponseV1
} from "../contracts/assistantResponseContract.js";

describe("parseAssistantResponseV1", () => {
  it("accepts a valid v1 response", () => {
    const result = parseAssistantResponseV1(
      '{"contract_version":"1.0","reply":"Merhaba","internal_boss_note":"log only"}'
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.reply).toBe("Merhaba");
      expect(result.value.internal_boss_note).toBe("log only");
    }
  });

  it.each([
    ["plain text", "INVALID_JSON", "hello"],
    ["code fence", "CODE_FENCE_NOT_ALLOWED", '```json\n{"contract_version":"1.0"}\n```'],
    ["array", "ARRAY_NOT_ALLOWED", "[]"],
    ["missing contract version", "MISSING_CONTRACT_VERSION", '{"reply":"x","internal_boss_note":""}'],
    [
      "unsupported contract version",
      "UNSUPPORTED_CONTRACT_VERSION",
      '{"contract_version":"1.1","reply":"x","internal_boss_note":""}'
    ],
    ["missing reply", "MISSING_REPLY", '{"contract_version":"1.0","internal_boss_note":""}'],
    ["missing internal note", "MISSING_INTERNAL_BOSS_NOTE", '{"contract_version":"1.0","reply":"x"}'],
    ["empty reply", "EMPTY_REPLY", '{"contract_version":"1.0","reply":" ","internal_boss_note":""}'],
    [
      "internal note leak",
      "INTERNAL_NOTE_LEAK_RISK",
      '{"contract_version":"1.0","reply":"internal_boss_note: gizli","internal_boss_note":"x"}'
    ],
    [
      "operator note leak",
      "INTERNAL_NOTE_LEAK_RISK",
      '{"contract_version":"1.0","reply":"operatör notu: gizli","internal_boss_note":"x"}'
    ],
    [
      "manager note leak",
      "INTERNAL_NOTE_LEAK_RISK",
      '{"contract_version":"1.0","reply":"yönetici notu: gizli","internal_boss_note":"x"}'
    ]
  ])("rejects %s with %s", (_name, code, raw) => {
    const result = parseAssistantResponseV1(raw);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(code);
    }
  });

  it("allows an empty internal_boss_note", () => {
    const result = parseAssistantResponseV1('{"contract_version":"1.0","reply":"Hazir","internal_boss_note":""}');

    expect(result.ok).toBe(true);
  });

  it("exposes the SPEC fallback constant", () => {
    expect(ASSISTANT_SAFE_FALLBACK_REPLY).toContain("teknik sorun");
  });
});
