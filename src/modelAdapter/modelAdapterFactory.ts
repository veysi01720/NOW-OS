import type { ThreadStore } from "../storage/threadStore.js";
import { AssistantAdapter } from "./AssistantAdapter.js";
import type { IModelAdapter } from "./IModelAdapter.js";

export interface ModelAdapterFactoryInput {
  assistantClient: ConstructorParameters<typeof AssistantAdapter>[0];
  threadStore: ThreadStore;
}

export function createModelAdapter(input: ModelAdapterFactoryInput): IModelAdapter {
  return new AssistantAdapter(input.assistantClient, input.threadStore);
}
