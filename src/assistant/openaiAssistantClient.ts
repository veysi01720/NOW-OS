import OpenAI from "openai";

export interface AssistantClient {
  createThread(): Promise<string>;
  runAssistant(threadId: string, content: string): Promise<string>;
}

export interface OpenAIRuntime {
  beta: {
    threads: {
      create(): Promise<{ id: string }>;
      messages: {
        create(threadId: string, input: { role: "user"; content: string }): Promise<unknown>;
        list(threadId: string, input: { limit: number; order: "desc" }): Promise<{
          data: Array<{ role?: string; content?: Array<{ type?: string; text?: { value?: string } }> }>;
        }>;
      };
      runs: {
        createAndPoll(threadId: string, input: { assistant_id: string; max_prompt_tokens?: number; additional_instructions?: string; truncation_strategy?: { type: "auto" | "last_messages"; last_messages?: number } }): Promise<{
          status: string;
          id?: string;
          last_error?: unknown;
          incomplete_details?: unknown;
        }>;
      };
    };
  };
}

function extractAssistantText(message: unknown): string {
  const record = message as { content?: Array<{ type?: string; text?: { value?: string } }> };
  const firstText = record.content?.find((part) => part.type === "text");
  return firstText?.text?.value ?? "";
}

export class OpenAIAssistantClient implements AssistantClient {
  private readonly client: OpenAIRuntime;

  constructor(apiKey: string, private readonly assistantId: string, client?: OpenAIRuntime) {
    this.client = client ?? new OpenAI({ apiKey });
  }

  async createThread(): Promise<string> {
    const thread = await this.client.beta.threads.create();
    return thread.id;
  }

  async runAssistant(threadId: string, content: string): Promise<string> {
    await this.client.beta.threads.messages.create(threadId, {
      role: "user",
      content
    });

    const conversationDecisionV2Run =
      content.includes("<conversation_decision_v2_instructions>") ||
      content.includes("decision_version 2.0");

    const run = await this.client.beta.threads.runs.createAndPoll(threadId, {
      assistant_id: this.assistantId,
      ...(conversationDecisionV2Run
        ? {
            additional_instructions: [
              "This run must ignore any older Assistant Response Contract v1 output format.",
              "Return ONLY a single valid JSON object for Conversation Decision v2.",
              "The top-level keys must include decision_version, intent, direct_question, reply, chosen_actions, state_patch, policy_facts_used, next_action, requires_escalation, escalation_reason, risk_flags, and self_check.",
              "The reply field must be an object with text, language, tone, and contains_question.",
              "Do not include contract_version, internal_boss_note, conversation_boss_note, markdown fences, or prose outside JSON.",
            ].join("\\n"),
          }
        : {}),
      truncation_strategy: { type: "last_messages", last_messages: 10 }
    });

    if (run.status !== "completed") {
      const errorDetails = run.last_error ? JSON.stringify(run.last_error) : (run.incomplete_details ? `incomplete_details=${JSON.stringify(run.incomplete_details)}` : "No last_error provided");
      throw new Error(`OpenAI Assistant run did not complete. status=${run.status}, last_error=${errorDetails}`);
    }

    const messages = await this.client.beta.threads.messages.list(threadId, {
      limit: 10,
      order: "desc"
    });
    const latestAssistantMessage = messages.data.find((message) => message.role === "assistant");

    return extractAssistantText(latestAssistantMessage);
  }
}
