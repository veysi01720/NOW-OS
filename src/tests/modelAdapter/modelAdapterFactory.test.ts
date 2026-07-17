import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createModelAdapter } from "../../modelAdapter/modelAdapterFactory.js";
import { FakeAssistantClient } from "../testDoubles.js";
import { InMemoryThreadStore } from "../../storage/threadStore.js";

describe("model adapter factory safety", () => {
  it("keeps AssistantAdapter as the only implemented provider adapter", () => {
    const adapter = createModelAdapter({
      assistantClient: new FakeAssistantClient(),
      threadStore: new InMemoryThreadStore(),
    });

    expect(adapter.name).toBe("AssistantAdapter");
    expect(adapter.provider).toBe("openai_assistant");
    expect(adapter.getIdentity()).toEqual({
      adapter_name: "AssistantAdapter",
      provider: "openai_assistant",
      model: "assistant_binding",
    });
  });

  it("does not expose provider key selection or unimplemented adapters", () => {
    const source = readFileSync(join(process.cwd(), "src/modelAdapter/modelAdapterFactory.ts"), "utf8");

    expect(source).not.toContain("providerKey");
    expect(source).not.toContain("ResponsesAdapter");
    expect(source).not.toContain("ClaudeAdapter");
    expect(source).not.toContain("switch");
  });

  it("keeps the factory and adapter contract type checked", () => {
    const contract = readFileSync(join(process.cwd(), "src/modelAdapter/IModelAdapter.ts"), "utf8");
    const adapter = readFileSync(join(process.cwd(), "src/modelAdapter/AssistantAdapter.ts"), "utf8");
    const factory = readFileSync(join(process.cwd(), "src/modelAdapter/modelAdapterFactory.ts"), "utf8");

    expect(contract).toContain("run(input: ModelAdapterInput)");
    expect(contract).not.toContain("execute(request:");
    expect(`${adapter}\n${factory}`).not.toContain("@ts-nocheck");
  });
});
