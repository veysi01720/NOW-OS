import { describe, expect, it } from "vitest";
import { InMemoryStore } from "../storage/memoryStore.js";

describe("conversation memory reset", () => {
  it("clears stale assistant replies when a candidate conversation is reset", () => {
    const memory = new InMemoryStore();
    memory.appendBotReply("905555555555", "Bu cevabi guvenli sekilde netlestiremedim; ekip kontrol etsin.");

    memory.clear("905555555555");

    expect(memory.get("905555555555").last_5_bot_replies).toEqual([]);
    expect(memory.get("905555555555").last_10_messages).toEqual([]);
  });
});
