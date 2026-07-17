import { describe, it, expect, vi } from "vitest";
import { resolveSenderRole, type RoleWhitelist } from "../config/roles.js";
import { logger } from "../observability/logger.js";

describe("roleResolution", () => {
  const whitelist: RoleWhitelist = {
    ownerPhoneNumbers: ["905371112233"],
    managerPhoneNumbers: ["905374445566", "905371112233"] // 1112233 is a collision
  };

  it("should resolve owner regardless of format", () => {
    const formats = [
      "+90 537 111 22 33",
      "05371112233",
      "5371112233",
      "905371112233",
      "+90-537-111-22-33",
      "  905371112233  "
    ];

    for (const fmt of formats) {
      const role = resolveSenderRole(fmt, whitelist, { chatType: "private" });
      expect(role).toBe("owner");
    }
  });

  it("should resolve manager regardless of format", () => {
    const formats = [
      "+90 537 444 55 66",
      "05374445566",
      "5374445566",
      "905374445566",
      "+90-537-444-55-66"
    ];

    for (const fmt of formats) {
      const role = resolveSenderRole(fmt, whitelist, { chatType: "private" });
      expect(role).toBe("manager");
    }
  });

  it("should apply owner precedence and log warning on collision", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    
    // "905371112233" is in both lists
    const role = resolveSenderRole("+90 537 111 22 33", whitelist, { chatType: "private" });
    
    expect(role).toBe("owner");
    expect(warnSpy).toHaveBeenCalled();
    const warnArgs = warnSpy.mock.calls[0][0] as any;
    expect(warnArgs.event_type).toBe("OWNER_MANAGER_ROLE_COLLISION");
    expect(warnArgs.precedence_applied).toBe("owner");

    warnSpy.mockRestore();
  });

  it("should resolve candidate for unknown private messages", () => {
    const role = resolveSenderRole("905559998877", whitelist, { chatType: "private" });
    expect(role).toBe("candidate");
  });
});
