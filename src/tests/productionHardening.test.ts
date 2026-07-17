import { describe, it, expect, vi } from "vitest";
import { redactSecrets, sanitizeLogObject, assertNoSensitiveLeak } from "../utils/redaction.js";
import { validateProductionEnv, getSafeConfigSummary } from "../config/envValidator.js";
import type { EnvConfig } from "../config/env.js";

describe("Production Hardening & Sanitization", () => {
  it("scrubs phone patterns", () => {
    expect(redactSecrets("Call +12345678901 for help")).toBe("Call [REDACTED_PHONE] for help");
  });

  it("scrubs remoteJid patterns", () => {
    expect(redactSecrets("User 905551234567@s.whatsapp.net joined")).toBe("User [REDACTED_JID] joined");
  });

  it("scrubs OpenAI ID patterns", () => {
    expect(redactSecrets("Thread: thread_abc123DEF456ghi789jkl012")).toBe("Thread: [REDACTED_ID]");
  });

  it("sanitizes log objects by masking sensitive keys", () => {
    const raw = {
      user: "test",
      internal_boss_note: "super secret",
      openaiApiKey: "sk-12345",
      dashboardOwnerToken: "secret_token_abc"
    };
    const sanitized = sanitizeLogObject(raw);
    expect(sanitized.user).toBe("test");
    expect(sanitized.internal_boss_note).toBe("***");
    expect(sanitized.openaiApiKey).toBe("***");
    expect(sanitized.dashboardOwnerToken).toBe("***");
  });

  it("asserts no sensitive leak correctly", () => {
    expect(assertNoSensitiveLeak("hello world")).toBe(true);
    expect(assertNoSensitiveLeak("My number is +12345678901")).toBe(false);
  });

  it("validateProductionEnv fails safely on missing required env in production", () => {
    const fakeEnv: EnvConfig = {
      port: 3000,
      openaiApiKey: "",
      dashboardOwnerToken: "token",
    } as any;
    
    // Stub process.exit to prevent test runner exit
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    validateProductionEnv(fakeEnv, true);
    
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleSpy).toHaveBeenCalled();
    const errorLog = consoleSpy.mock.calls[0][0];
    expect(errorLog).toContain("Missing required environment variables");
    expect(errorLog).not.toContain("sk-"); // Should never log actual prefix
    
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it("validateProductionEnv does not hard fail in non-production", () => {
    const fakeEnv: EnvConfig = { port: 3000 } as any;
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
    
    validateProductionEnv(fakeEnv, false);
    
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it("getSafeConfigSummary returns boolean presence without secrets", () => {
    const fakeEnv: EnvConfig = {
      dashboardOwnerToken: "real_token_123",
      dashboardManagerToken: "manager_token",
      openaiApiKey: "sk-123",
      openaiAssistantId: "asst_123",
      evolutionApiBaseUrl: "http://evo",
      evolutionApiKey: "evo-key",
      evolutionInstance: "inst1"
    } as any;
    
    const summary = getSafeConfigSummary(fakeEnv);
    expect(summary.dashboard_owner_token_configured).toBe(true);
    expect(summary.openai_configured).toBe(true);
    expect(summary.evolution_configured).toBe(true);
    // Ensure no raw token leaked
    expect(JSON.stringify(summary)).not.toContain("real_token_123");
    expect(JSON.stringify(summary)).not.toContain("sk-123");
  });
});
