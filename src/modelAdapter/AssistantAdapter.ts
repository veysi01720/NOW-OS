import type { AssistantClient } from "../assistant/openaiAssistantClient.js";
import { buildAssistantRunContent } from "../assistant/assistantRun.js";
import { parseAssistantResponseV1 } from "../contracts/assistantResponseContract.js";
import type { ThreadStore } from "../storage/threadStore.js";
import type { IModelAdapter, ModelAdapterIdentity } from "./IModelAdapter.js";
import type { ModelAdapterHealth, ModelAdapterInput, ModelAdapterOutput } from "./types.js";

export class AssistantAdapter implements IModelAdapter {
  readonly name = "AssistantAdapter";
  readonly provider = "openai_assistant";

  constructor(
    private readonly assistantClient: AssistantClient,
    private readonly threadStore: ThreadStore,
  ) {}

  async run(input: ModelAdapterInput): Promise<ModelAdapterOutput> {
    const threadId = await this.threadStore.getOrCreate(input.conversationId, () =>
      this.assistantClient.createThread(),
    );
    const rawText = await this.assistantClient.runAssistant(
      threadId,
      buildAssistantRunContent(input.contextPayload),
    );
    const parsed = parseAssistantResponseV1(rawText);

    return {
      normalizedResponse: parsed.ok
        ? {
            reply: parsed.value.reply,
            internal_boss_note: parsed.value.internal_boss_note,
          }
        : null,
      rawText,
      providerTrace: {
        provider: this.provider,
        adapter: this.name,
        response_contract_version: input.responseContractVersion,
      },
      finishReason: "assistant_run_completed",
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
      model: "assistant_binding",
    };
  }
}
