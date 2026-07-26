import { OpenAIAssistantClient, type OpenAIRuntime } from "../assistant/openaiAssistantClient.js";

function createRuntime(status: string): OpenAIRuntime & { messagesListCalls: number; runInput?: unknown } {
  return {
    messagesListCalls: 0,
    beta: {
      threads: {
        create: async () => ({ id: "thread_1" }),
        messages: {
          create: async () => ({}),
          list: async () => {
            runtime.messagesListCalls += 1;
            return {
              data: [
                {
                  role: "assistant",
                  content: [{ type: "text", text: { value: "old assistant message" } }]
                }
              ]
            };
          }
        },
        runs: {
          createAndPoll: async (_threadId, input) => {
            runtime.runInput = input;
            return { status };
          }
        }
      }
    }
  };
}

let runtime: OpenAIRuntime & { messagesListCalls: number; runInput?: unknown };

describe("OpenAIAssistantClient", () => {
  it("does not fetch an old assistant message when run status is not completed", async () => {
    runtime = createRuntime("failed");
    const client = new OpenAIAssistantClient("test-key", "asst_test", runtime);

    await expect(client.runAssistant("thread_1", "content")).rejects.toThrow(
      "OpenAI Assistant run did not complete. status=failed"
    );
    expect(runtime.messagesListCalls).toBe(0);
  });

  it("bounds prompt and completion budgets for long-lived assistant threads", async () => {
    runtime = createRuntime("failed");
    const client = new OpenAIAssistantClient("test-key", "asst_test", runtime);

    await expect(client.runAssistant("thread_1", "content")).rejects.toThrow();

    expect(runtime.runInput).toMatchObject({
      max_prompt_tokens: 18000,
      max_completion_tokens: 2000,
      truncation_strategy: { type: "last_messages", last_messages: 6 }
    });
  });
});
