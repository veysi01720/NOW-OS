import { describe, expect, it } from "vitest";
import { calculateHumanReplyDelayMs, waitForHumanReplyDelay } from "../bridge/humanReplyDelay.js";

describe("human reply delay", () => {
  it("maps short and long replies into the 1.5-4 second range", () => {
    expect(calculateHumanReplyDelayMs("kisa", () => 0)).toBe(1500);
    expect(calculateHumanReplyDelayMs("x".repeat(400), () => 0.999)).toBeGreaterThanOrEqual(3996);
    expect(calculateHumanReplyDelayMs("x".repeat(400), () => 0.999)).toBeLessThan(4000);
  });

  it("waits before sending instead of allowing an immediate send", async () => {
    const sleeps: number[] = [];
    const delay = await waitForHumanReplyDelay("normal candidate reply", {
      random: () => 0.5,
      sleep: async (milliseconds) => { sleeps.push(milliseconds); },
    });
    expect(delay).toBeGreaterThanOrEqual(1500);
    expect(delay).toBeLessThan(4000);
    expect(sleeps).toEqual([delay]);
    expect(sleeps[0]).toBeGreaterThan(0);
  });
});
