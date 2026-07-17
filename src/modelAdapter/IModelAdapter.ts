import type { ModelAdapterHealth, ModelAdapterInput, ModelAdapterOutput } from "./types.js";

export interface ModelAdapterIdentity {
  adapter_name: string;
  provider: string;
  model: string;
}

export interface IModelAdapter {
  readonly name: string;
  readonly provider: string;
  run(input: ModelAdapterInput): Promise<ModelAdapterOutput>;
  health(): Promise<ModelAdapterHealth>;
  getIdentity(): ModelAdapterIdentity;
}
