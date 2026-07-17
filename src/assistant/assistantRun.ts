import type { BackendContextPayloadV1 } from "../contracts/backendContextPayload.js";
import type { AssistantClient } from "./openaiAssistantClient.js";

export function buildAssistantRunContent(backendContext: BackendContextPayloadV1): string {
  const lines = [
    "Use the following backend_context as the source of truth.",
    "Do not infer sender_role, chat_type, state, or memory outside this context."
  ];

  if (backendContext.conversation_decision_v2) {
    lines.push(
      "Return only Conversation Decision JSON with decision_version 2.0.",
      "Use backend_context.conversation_decision_v2_instructions as the highest priority behavior instructions for this run."
    );
    if (backendContext.conversation_decision_v2_instructions) {
      lines.push(
        "",
        "<conversation_decision_v2_instructions>",
        backendContext.conversation_decision_v2_instructions,
        "</conversation_decision_v2_instructions>"
      );
    }
  } else {
    lines.push("Return only Assistant Response Contract v1.0 JSON.");
  }

  if (backendContext.chat_type === "group") {
    lines.push(
      "",
      "--- Group Operations Rule ---",
      "- In group chat, never start personal onboarding.",
      "- Do not ask for selected_app or phone_type in group.",
      "- Do not request private/sensitive information.",
      "- Do not expose owner reports, internal notes, logs, IDs, full phone numbers, or backend details.",
      "- Keep replies short, general, and safe.",
      "- If support/training/installation issue appears, acknowledge generally and say the team will help.",
      "- Do not fabricate report data.",
      "- Use only backend_context and approved knowledge."
    );
  }

  if (backendContext.learning_review) {
    lines.push(
      "",
      "--- Learning Review Rule ---",
      "- If backend_context.learning_review exists, answer only from learning_review.",
      "- Do not invent suggestions.",
      "- Do not expose raw suggestion_id, internal IDs, logs, raw platform IDs, full phone numbers, tokens, or secrets.",
      "- Do not claim the Assistant learned the suggestion.",
      "- Do not claim Knowledge Bank was updated.",
      "- If approved, say it was moved to the approved learning pool only.",
      "- If learning_review is missing, say there is not enough learning review data."
    );
  }

  if (backendContext.knowledge_sync) {
    lines.push(
      "",
      "--- Knowledge Sync Rule ---",
      "- If backend_context.knowledge_sync exists, answer only from knowledge_sync.",
      "- State the action result clearly.",
      "- Do not claim the Assistant learned this data.",
      "- Do not claim the Assistant's system prompt or knowledge base was automatically updated.",
      "- State only that the secure local knowledge target sync is complete or skipped.",
      "- Never expose raw internal IDs or PII."
    );
  }

  if (backendContext.knowledge_publish) {
    lines.push(
      "",
      "--- Knowledge Publish Rule ---",
      "- If backend_context.knowledge_publish exists, answer only from knowledge_publish.",
      "- Do not invent publish results.",
      "- Do not expose raw OpenAI file IDs, vector store IDs, assistant IDs, internal IDs, logs, full phone numbers, tokens, or secrets.",
      "- Do not claim the Assistant learned the content.",
      "- Do not claim File Search or Vector Store was refreshed unless backend_context.knowledge_publish.action_result.success is true and mode is 'real'.",
      "- If mode is 'mock', state clearly: 'Mock publish akışı başarıyla tamamlandı. Gerçek OpenAI File Search güncellenmedi.'",
      "- Do not claim Assistant prompt/instructions changed.",
      "- If publish is preview-only, say it is only ready/previewed, not published.",
      "- If config is missing, say publish cannot run until backend config is completed.",
      "- If duplicate hash, say there are no new knowledge changes to publish."
    );
  }

  if (backendContext.daily_report) {
    lines.push(
      "",
      "--- Daily Owner Report Rule ---",
      "- If backend_context.daily_report exists, answer only from daily_report.",
      "- Do not invent counts, candidate numbers, publisher states, or group summaries.",
      "- Keep report structured and professional.",
      "- Do not expose raw internal IDs, group IDs, full phone numbers, or tokens.",
      "- Clearly state the duplicate_status if it is not 'first_generated'.",
      "- If data is empty, say there is not enough data yet."
    );
  }

  lines.push(
    "",
    "<backend_context_json>",
    JSON.stringify(backendContext),
    "</backend_context_json>"
  );

  return lines.join("\n");
}

export async function runAssistantWithBackendContext(
  assistantClient: AssistantClient,
  threadId: string,
  backendContext: BackendContextPayloadV1
): Promise<string> {
  return assistantClient.runAssistant(threadId, buildAssistantRunContent(backendContext));
}
