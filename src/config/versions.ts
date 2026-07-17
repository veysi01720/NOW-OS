export const SUPPORTED_ASSISTANT_RESPONSE_CONTRACT_VERSION = "1.0" as const;
export const BACKEND_CONTEXT_VERSION = "1.0" as const;

export interface VersionConfig {
  assistant_response_contract_version: typeof SUPPORTED_ASSISTANT_RESPONSE_CONTRACT_VERSION;
  system_prompt_version: string;
  knowledge_base_version: string;
  backend_context_version: typeof BACKEND_CONTEXT_VERSION;
  state_machine_version: string;
}
