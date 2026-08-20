export type OwnerNaturalIntent =
  | "knowledge_addition"
  | "candidate_relay"
  | "operational_query"
  | "normal_chat"
  | "confirm_pending_knowledge"
  | "reject_pending_knowledge"
  | "rollback_last_knowledge"
  | "show_knowledge_details"
  | "zip_review_selection";

export interface OwnerNaturalLanguageDecision {
  intent: OwnerNaturalIntent;
  confidence: number;
  knowledge_text: string | null;
  candidate_reference: string | null;
  relay_text: string | null;
  conflict_detected: boolean;
  ambiguity_detected: boolean;
  clarification_question: string | null;
  selected_section_ids: string[];
  rejected_section_ids: string[];
  apply_selection: boolean;
  operational_query_kind?: "recent_inbound_activity" | "candidate_overview" | "pending_handoffs" | null;
  operational_time_window_minutes?: number | null;
}

export interface OwnerNaturalLanguageIntentInput {
  message: string;
  activeKnowledge: string;
  pendingKnowledge: Array<{ id: string; title: string; classification: string }>;
  pendingCandidateSuffixes: string[];
}

export interface OwnerNaturalLanguageIntentClassifier {
  classify(input: OwnerNaturalLanguageIntentInput): Promise<OwnerNaturalLanguageDecision>;
}

interface ResponsesRuntime {
  responses: {
    create(input: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
  };
}

const OWNER_INTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "intent", "confidence", "knowledge_text", "candidate_reference", "relay_text",
    "conflict_detected", "ambiguity_detected", "clarification_question",
    "selected_section_ids", "rejected_section_ids", "apply_selection",
    "operational_query_kind", "operational_time_window_minutes",
  ],
  properties: {
    intent: { type: "string", enum: [
      "knowledge_addition", "candidate_relay", "normal_chat", "confirm_pending_knowledge",
      "reject_pending_knowledge", "rollback_last_knowledge", "show_knowledge_details", "zip_review_selection",
      "operational_query",
    ] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    knowledge_text: { type: ["string", "null"] },
    candidate_reference: { type: ["string", "null"] },
    relay_text: { type: ["string", "null"] },
    conflict_detected: { type: "boolean" },
    ambiguity_detected: { type: "boolean" },
    clarification_question: { type: ["string", "null"] },
    selected_section_ids: { type: "array", items: { type: "string" } },
    rejected_section_ids: { type: "array", items: { type: "string" } },
    apply_selection: { type: "boolean" },
    operational_query_kind: {
      type: ["string", "null"],
      enum: ["recent_inbound_activity", "candidate_overview", "pending_handoffs", null],
    },
    operational_time_window_minutes: { type: ["number", "null"], minimum: 1, maximum: 10_080 },
  },
} as const;

function outputText(response: Record<string, unknown>): string {
  if (typeof response.output_text === "string") return response.output_text;
  const output = Array.isArray(response.output) ? response.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown }).content)
      ? (item as { content: unknown[] }).content
      : [];
    for (const part of content) {
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
        chunks.push((part as { text: string }).text);
      }
    }
  }
  return chunks.join("\n").trim();
}

function parseDecision(value: string): OwnerNaturalLanguageDecision {
  const parsed = JSON.parse(value) as OwnerNaturalLanguageDecision;
  if (!parsed || typeof parsed !== "object" || typeof parsed.intent !== "string") {
    throw new Error("OWNER_INTENT_RESPONSE_INVALID");
  }
  return parsed;
}

export async function createOpenAIOwnerNaturalLanguageIntentClassifier(input: {
  apiKey: string;
  model: string;
  timeoutMs?: number;
}): Promise<OwnerNaturalLanguageIntentClassifier> {
  const { default: OpenAI } = await import("openai");
  const runtime = new OpenAI({ apiKey: input.apiKey }) as unknown as ResponsesRuntime;
  const timeoutMs = input.timeoutMs ?? 30_000;
  return {
    async classify(context): Promise<OwnerNaturalLanguageDecision> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await runtime.responses.create({
          model: input.model,
          store: false,
          input: [
            {
              role: "system",
              content: [{ type: "input_text", text: [
                "You classify private Turkish messages from an authenticated business owner. Do not answer the message.",
                "knowledge_addition: a declarative rule or operational fact the owner intends the system to learn.",
                "candidate_relay: an explicit request to tell/send a message to a candidate or phone reference.",
                "operational_query: a read-only question about real system or candidate activity. Choose recent_inbound_activity for questions asking whether anyone wrote, whether a new message/candidate arrived, or who contacted the bot; candidate_overview for candidate counts or onboarding states; pending_handoffs for pending owner reviews or escalations.",
                "normal_chat: a general question, discussion, or casual conversation that does not require live operational data.",
                "confirm_pending_knowledge/reject_pending_knowledge: a free-form answer to the one pending clarification.",
                "rollback_last_knowledge: asks to undo the most recent knowledge change.",
                "show_knowledge_details: explicitly asks for technical details, audit proof, fields, paths, hashes, or rollback information about the latest knowledge change.",
                "zip_review_selection: selects/rejects pending multi-section ZIP items; copy only supplied section IDs.",
                "A statement is conflicting when it changes or contradicts active knowledge. Ambiguous means its intended rule cannot be stated confidently.",
                "Never classify a question as knowledge addition. Never classify ordinary owner chat as candidate relay.",
                "For candidate relay, preserve meaning in relay_text and extract the phone/last-four reference when present.",
                "For operational_query, select exactly one operational_query_kind and infer a reasonable time window from the owner's words. Use 1440 minutes when no window is stated. Do not answer from conversation memory.",
                "For a clear knowledge addition, put the self-contained fact in knowledge_text.",
              ].join("\n") }],
            },
            {
              role: "user",
              content: [{ type: "input_text", text: JSON.stringify({
                owner_message: context.message,
                active_knowledge: context.activeKnowledge.slice(0, 50_000),
                pending_knowledge: context.pendingKnowledge,
                pending_candidate_suffixes: context.pendingCandidateSuffixes,
              }) }],
            },
          ],
          text: { format: { type: "json_schema", name: "owner_natural_language_intent", strict: true, schema: OWNER_INTENT_SCHEMA } },
          max_output_tokens: 700,
        }, { signal: controller.signal });
        return parseDecision(outputText(response));
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
