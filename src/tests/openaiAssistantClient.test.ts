import { OpenAIAssistantClient, type OpenAIRuntime } from "../assistant/openaiAssistantClient.js";

function createRuntime(status: string): OpenAIRuntime & { messagesListCalls: number } {
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
          createAndPoll: async () => ({ status })
        }
      }
    }
  };
}

let runtime: OpenAIRuntime & { messagesListCalls: number };

describe("OpenAIAssistantClient", () => {
  it("does not fetch an old assistant message when run status is not completed", async () => {
    runtime = createRuntime("failed");
    const client = new OpenAIAssistantClient("test-key", "asst_test", runtime);

    await expect(client.runAssistant("thread_1", "content")).rejects.toThrow(
      "OpenAI Assistant run did not complete. status=failed"
    );
    expect(runtime.messagesListCalls).toBe(0);
  });
});
