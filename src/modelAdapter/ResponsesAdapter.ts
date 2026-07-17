import type { IModelAdapter, ModelAdapterIdentity } from "./IModelAdapter.js";
import type { ModelAdapterHealth, ModelAdapterInput, ModelAdapterOutput } from "./types.js";
import {
  CONVERSATION_DECISION_V3_SCHEMA,
  CONVERSATION_DECISION_V3_SCHEMA_NAME,
} from "../intelligence/conversation/ConversationDecisionV3Schema.js";
import { buildResponsesDecisionContext, buildResponsesSystemInstructions } from "./responsesDecisionPrompt.js";

interface ResponsesRuntime {
  responses: {
    create(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
}

export async function createOpenAIResponsesAdapter(input: { apiKey: string; model: string }): Promise<ResponsesAdapter> {
  const { default: OpenAI } = await import("openai");
  const runtime = new OpenAI({ apiKey: input.apiKey }) as unknown as ResponsesRuntime;
  return new ResponsesAdapter({ runtime, model: input.model });
}

export interface ResponsesAdapterOptions {
  runtime: ResponsesRuntime;
  model: string;
}

function extractOutputText(response: Record<string, unknown>): string {
  if (typeof response.output_text === "string") return response.output_text;

  const output = response.output;
  if (!Array.isArray(output)) return "";

  const chunks: string[] = [];
  for (const item of output) {
    if (typeof item === "object" && item !== null && Array.isArray((item as { content?: unknown }).content)) {
      for (const content of (item as { content: unknown[] }).content) {
        if (typeof content === "object" && content !== null) {
          const text = (content as { text?: unknown }).text;
          if (typeof text === "string") chunks.push(text);
        }
      }
    }
  }
  return chunks.join("\n").trim();
}

function usageFromResponse(response: Record<string, unknown>): ModelAdapterOutput["usage"] {
  const usage = response.usage;
  if (typeof usage !== "object" || usage === null) return undefined;
  const prompt = (usage as { input_tokens?: unknown; prompt_tokens?: unknown }).input_tokens
    ?? (usage as { prompt_tokens?: unknown }).prompt_tokens;
  const completion = (usage as { output_tokens?: unknown; completion_tokens?: unknown }).output_tokens
    ?? (usage as { completion_tokens?: unknown }).completion_tokens;
  return {
    inputTokens: typeof prompt === "number" ? prompt : undefined,
    outputTokens: typeof completion === "number" ? completion : undefined,
  };
}

export class ResponsesAdapter implements IModelAdapter {
  readonly name = "ResponsesAdapter";
  readonly provider = "openai_responses";

  constructor(private readonly options: ResponsesAdapterOptions) {}

  async run(input: ModelAdapterInput): Promise<ModelAdapterOutput> {
    const decisionContext = buildResponsesDecisionContext(input);
    const response = await this.createDecisionResponse({
      traceId: input.metadata.traceId,
      decisionContext,
    });
    const rawText = extractOutputText(response);

    return {
      normalizedResponse: null,
      rawText,
      usage: usageFromResponse(response),
      providerTrace: {
        provider: this.provider,
        adapter: this.name,
        response_contract_version: "conversation_decision_v3",
      },
      finishReason: typeof response.status === "string" ? response.status : "responses_completed",
      rawProviderResponseStored: false,
    };
  }

  async health(): Promise<ModelAdapterHealth> {
    return {
      ok: true,
      provider: this.provider,
      supportsResponseContractVersion: "1.0",
    };
  }

  getIdentity(): ModelAdapterIdentity {
    return {
      adapter_name: this.name,
      provider: this.provider,
      model: this.options.model,
    };
  }

  private createDecisionResponse(input: {
    traceId: string;
    decisionContext: ReturnType<typeof buildResponsesDecisionContext>;
  }): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = {
      model: this.options.model,
      store: false,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: buildResponsesSystemInstructions(),
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                trace_id: input.traceId,
                decision_context: input.decisionContext,
              }),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: CONVERSATION_DECISION_V3_SCHEMA_NAME,
          schema: CONVERSATION_DECISION_V3_SCHEMA,
          strict: true,
        },
      },
    };

    return this.options.runtime.responses.create(payload);
  }
}
