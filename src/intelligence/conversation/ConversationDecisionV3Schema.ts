export const CONVERSATION_DECISION_V3_SCHEMA_NAME = "conversation_decision_v3";
export const CONVERSATION_DECISION_V3_SCHEMA_VERSION = "3.1";

export const CONVERSATION_DECISION_V3_ACTIONS = [
  "answer_user_question",
  "clarify_previous_explanation",
  "acknowledge_information",
  "ask_missing_age",
  "ask_missing_gender",
  "ask_missing_daily_hours",
  "explain_work_model",
  "request_work_model_acceptance",
  "record_work_model_acceptance",
  "record_work_preference",
  "ask_selected_app",
  "ask_phone_type",
  "begin_setup",
  "provide_installation_instruction",
  "clarify_ambiguous_input",
  "escalate_policy_missing",
  "respond_to_off_topic_question",
  "handle_user_frustration",
] as const;

export const CONVERSATION_DECISION_V3_NEXT_ACTIONS = [
  "reply_only",
  "ask_missing_info",
  "answer_direct_question",
  "update_candidate_state",
  "enqueue_followup",
  "owner_report",
  "manager_summary",
  "request_human_handoff",
  "no_reply",
  "escalate",
] as const;

export const CONVERSATION_DECISION_V3_STATE_PATCH_FIELDS = [
  "age",
  "gender",
  "daily_hours",
  "work_model_acceptance",
  "selected_app",
  "phone_type",
  "work_model_disclosed",
  "preferred_work_mode",
  "video_allowed",
] as const;

export const CONVERSATION_DECISION_V3_EVIDENCE_SOURCES = [
  "current_message",
  "existing_state",
  "canonical_policy_fact",
  "reply_content",
] as const;

export type ConversationDecisionV3Action = typeof CONVERSATION_DECISION_V3_ACTIONS[number];
export type ConversationDecisionV3NextAction = typeof CONVERSATION_DECISION_V3_NEXT_ACTIONS[number];
export type ConversationDecisionV3StatePatchField = typeof CONVERSATION_DECISION_V3_STATE_PATCH_FIELDS[number];
export type ConversationDecisionV3EvidenceSource = typeof CONVERSATION_DECISION_V3_EVIDENCE_SOURCES[number];

type JsonSchema = Record<string, unknown>;

const stringArraySchema: JsonSchema = {
  type: "array",
  items: { type: "string" },
};

const nullableStringSchema: JsonSchema = {
  anyOf: [{ type: "string" }, { type: "null" }],
};

const nullableNumberSchema: JsonSchema = {
  anyOf: [{ type: "number" }, { type: "null" }],
};

const nullableBooleanSchema: JsonSchema = {
  anyOf: [{ type: "boolean" }, { type: "null" }],
};

export const CONVERSATION_DECISION_V3_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "decision_version",
    "intent",
    "role",
    "direct_question",
    "reply",
    "next_action",
    "chosen_actions",
    "state_patch",
    "state_patch_evidence",
    "missing_fields",
    "policy_facts_used",
    "requires_escalation",
    "escalation_reason",
    "risk_flags",
    "quality_signals",
    "self_check",
  ],
  properties: {
    decision_version: { type: "string", enum: [CONVERSATION_DECISION_V3_SCHEMA_VERSION] },
    intent: {
      type: "object",
      additionalProperties: false,
      required: ["primary", "secondary", "confidence"],
      properties: {
        primary: { type: "string", minLength: 1 },
        secondary: stringArraySchema,
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
    },
    role: {
      type: "string",
      enum: ["candidate", "owner", "manager", "group", "unknown"],
    },
    direct_question: {
      type: "object",
      additionalProperties: false,
      required: ["present", "question_summary", "answered_in_reply"],
      properties: {
        present: { type: "boolean" },
        question_summary: nullableStringSchema,
        answered_in_reply: { type: "boolean" },
      },
    },
    reply: {
      type: "object",
      additionalProperties: false,
      required: ["text", "language", "tone", "contains_question"],
      properties: {
        text: { type: "string", minLength: 1 },
        language: { type: "string", enum: ["tr"] },
        tone: {
          type: "string",
          enum: ["natural_concise", "warm", "managerial", "neutral"],
        },
        contains_question: { type: "boolean" },
      },
    },
    next_action: { type: "string", enum: [...CONVERSATION_DECISION_V3_NEXT_ACTIONS] },
    chosen_actions: {
      type: "array",
      items: { type: "string", enum: [...CONVERSATION_DECISION_V3_ACTIONS] },
    },
    state_patch: {
      type: "object",
      additionalProperties: false,
      required: [
        "age",
        "gender",
        "daily_hours",
        "work_model_acceptance",
        "selected_app",
        "phone_type",
        "work_model_disclosed",
        "preferred_work_mode",
        "video_allowed",
      ],
      properties: {
        age: nullableNumberSchema,
        gender: nullableStringSchema,
        daily_hours: nullableNumberSchema,
        work_model_acceptance: {
          anyOf: [
            { type: "string", enum: ["pending", "accepted", "rejected"] },
            { type: "null" },
          ],
        },
        selected_app: nullableStringSchema,
        phone_type: nullableStringSchema,
        work_model_disclosed: nullableBooleanSchema,
        preferred_work_mode: {
          anyOf: [
            { type: "string", enum: ["text_only", "video_or_voice_allowed"] },
            { type: "null" },
          ],
        },
        video_allowed: nullableBooleanSchema,
      },
    },
    state_patch_evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "source", "evidence_ref"],
        properties: {
          field: { type: "string", enum: [...CONVERSATION_DECISION_V3_STATE_PATCH_FIELDS] },
          source: { type: "string", enum: [...CONVERSATION_DECISION_V3_EVIDENCE_SOURCES] },
          evidence_ref: nullableStringSchema,
        },
      },
    },
    missing_fields: stringArraySchema,
    policy_facts_used: stringArraySchema,
    requires_escalation: { type: "boolean" },
    escalation_reason: nullableStringSchema,
    risk_flags: stringArraySchema,
    quality_signals: {
      type: "object",
      additionalProperties: false,
      required: [
        "answered_latest_message",
        "used_relevant_state",
        "did_not_repeat_known_info",
        "asked_only_one_clear_question",
        "reply_is_natural_turkish",
        "no_generic_closer",
        "no_invented_policy",
        "correct_role_boundary",
      ],
      properties: {
        answered_latest_message: { type: "boolean" },
        used_relevant_state: { type: "boolean" },
        did_not_repeat_known_info: { type: "boolean" },
        asked_only_one_clear_question: { type: "boolean" },
        reply_is_natural_turkish: { type: "boolean" },
        no_generic_closer: { type: "boolean" },
        no_invented_policy: { type: "boolean" },
        correct_role_boundary: { type: "boolean" },
      },
    },
    self_check: {
      type: "object",
      additionalProperties: false,
      required: [
        "answered_latest_message",
        "asked_known_information_again",
        "invented_policy",
        "offered_setup_too_early",
        "used_generic_closing",
      ],
      properties: {
        answered_latest_message: { type: "boolean" },
        asked_known_information_again: { type: "boolean" },
        invented_policy: { type: "boolean" },
        offered_setup_too_early: { type: "boolean" },
        used_generic_closing: { type: "boolean" },
      },
    },
  },
};

export interface ConversationDecisionV3 {
  decision_version: "3.1";
  intent: {
    primary: string;
    secondary: string[];
    confidence: number;
  };
  role: "candidate" | "owner" | "manager" | "group" | "unknown";
  direct_question: {
    present: boolean;
    question_summary: string | null;
    answered_in_reply: boolean;
  };
  reply: {
    text: string;
    language: "tr";
    tone: "natural_concise" | "warm" | "managerial" | "neutral";
    contains_question: boolean;
  };
  next_action: ConversationDecisionV3NextAction;
  chosen_actions: ConversationDecisionV3Action[];
  state_patch: {
    age: number | null;
    gender: string | null;
    daily_hours: number | null;
    work_model_acceptance: "pending" | "accepted" | "rejected" | null;
    selected_app: string | null;
    phone_type: string | null;
    work_model_disclosed: boolean | null;
    preferred_work_mode: "text_only" | "video_or_voice_allowed" | null;
    video_allowed: boolean | null;
  };
  state_patch_evidence: Array<{
    field: ConversationDecisionV3StatePatchField;
    source: ConversationDecisionV3EvidenceSource;
    evidence_ref: string | null;
  }>;
  missing_fields: string[];
  policy_facts_used: string[];
  requires_escalation: boolean;
  escalation_reason: string | null;
  risk_flags: string[];
  quality_signals: {
    answered_latest_message: boolean;
    used_relevant_state: boolean;
    did_not_repeat_known_info: boolean;
    asked_only_one_clear_question: boolean;
    reply_is_natural_turkish: boolean;
    no_generic_closer: boolean;
    no_invented_policy: boolean;
    correct_role_boundary: boolean;
  };
  self_check: {
    answered_latest_message: boolean;
    asked_known_information_again: boolean;
    invented_policy: boolean;
    offered_setup_too_early: boolean;
    used_generic_closing: boolean;
  };
}

export interface ConversationDecisionV3ValidationResult {
  ok: boolean;
  reason_codes: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaProperties(schema: JsonSchema): Record<string, JsonSchema> {
  return (schema.properties ?? {}) as Record<string, JsonSchema>;
}

function validateAgainstSchema(schema: JsonSchema, value: unknown, path: string, reasons: string[]): void {
  if (schema.anyOf !== undefined) {
    const variants = schema.anyOf as JsonSchema[];
    const matched = variants.some((variant) => {
      const variantReasons: string[] = [];
      validateAgainstSchema(variant, value, path, variantReasons);
      return variantReasons.length === 0;
    });
    if (!matched) reasons.push(`TYPE_MISMATCH:${path}`);
    return;
  }

  if (schema.enum !== undefined && !(schema.enum as unknown[]).includes(value)) {
    reasons.push(`ENUM_MISMATCH:${path}`);
    return;
  }

  if (schema.type === "object") {
    if (!isRecord(value)) {
      reasons.push(`TYPE_MISMATCH:${path}`);
      return;
    }
    const properties = schemaProperties(schema);
    for (const requiredKey of (schema.required ?? []) as string[]) {
      if (!(requiredKey in value)) reasons.push(`MISSING_REQUIRED:${path}.${requiredKey}`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) reasons.push(`ADDITIONAL_PROPERTY:${path}.${key}`);
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (key in value) validateAgainstSchema(childSchema, value[key], `${path}.${key}`, reasons);
    }
    return;
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      reasons.push(`TYPE_MISMATCH:${path}`);
      return;
    }
    const itemSchema = schema.items as JsonSchema | undefined;
    if (itemSchema !== undefined) {
      value.forEach((item, index) => validateAgainstSchema(itemSchema, item, `${path}[${index}]`, reasons));
    }
    return;
  }

  if (schema.type === "string") {
    if (typeof value !== "string") {
      reasons.push(`TYPE_MISMATCH:${path}`);
      return;
    }
    if (typeof schema.minLength === "number" && value.trim().length < schema.minLength) {
      reasons.push(`MIN_LENGTH:${path}`);
    }
    return;
  }

  if (schema.type === "number") {
    if (typeof value !== "number" || Number.isNaN(value)) {
      reasons.push(`TYPE_MISMATCH:${path}`);
      return;
    }
    if (typeof schema.minimum === "number" && value < schema.minimum) reasons.push(`MINIMUM:${path}`);
    if (typeof schema.maximum === "number" && value > schema.maximum) reasons.push(`MAXIMUM:${path}`);
    return;
  }

  if (schema.type === "boolean" && typeof value !== "boolean") {
    reasons.push(`TYPE_MISMATCH:${path}`);
    return;
  }

  if (schema.type === "null" && value !== null) {
    reasons.push(`TYPE_MISMATCH:${path}`);
  }
}

export function validateConversationDecisionV3Shape(value: unknown): ConversationDecisionV3ValidationResult {
  const reason_codes: string[] = [];
  validateAgainstSchema(CONVERSATION_DECISION_V3_SCHEMA, value, "$", reason_codes);
  return { ok: reason_codes.length === 0, reason_codes };
}
