import { describe, expect, it } from "vitest";
import { isRuntimeLockConflict } from "../server.js";

describe("Runtime lock stale PID guard", () => {
  it("treats the current process PID as a stale persisted lock", () => {
    expect(isRuntimeLockConflict(1, 1, () => true)).toBe(false);
  });

  it("rejects a different live PID", () => {
    expect(isRuntimeLockConflict(42, 1, () => true)).toBe(true);
  });

  it("allows a different dead PID", () => {
    expect(isRuntimeLockConflict(42, 1, () => false)).toBe(false);
  });
});
