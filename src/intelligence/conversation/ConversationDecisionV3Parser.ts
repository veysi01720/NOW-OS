import type { ModelAdapterInput } from "../../modelAdapter/types.js";
import {
  CONVERSATION_DECISION_V3_SCHEMA_NAME,
  type ConversationDecisionV3,
  validateConversationDecisionV3Shape,
} from "./ConversationDecisionV3Schema.js";
import { mapConversationDecisionV3ToBackendDecision } from "./ConversationDecisionV3Mapper.js";
import {
  buildConversationDecisionV3SemanticContext,
  validateConversationDecisionV3Semantics,
} from "./ConversationDecisionV3SemanticValidator.js";
import {
  normalizeConversationDecisionV3MissingPolicy,
  type ConversationDecisionV3PolicyNormalizationResult,
} from "./ConversationDecisionV3PolicyNormalizer.js";
import type { ConversationDecision } from "./ConversationDecisionSchema.js";

export const CANONICAL_MODEL_RESPONSE_CONTRACT = CONVERSATION_DECISION_V3_SCHEMA_NAME;

export type ConversationDecisionV3ParseErrorCode =
  | "INVALID_JSON"
  | "SHAPE_INVALID"
  | "SEMANTIC_INVALID";

export type ConversationDecisionV3ParseResult =
  | {
      ok: true;
      decision: ConversationDecision;
      v3: ConversationDecisionV3;
      normalization: ConversationDecisionV3PolicyNormalizationResult | null;
      semanticValidation: ReturnType<typeof validateConversationDecisionV3Semantics>;
    }
  | {
      ok: false;
      error_code: ConversationDecisionV3ParseErrorCode;
      raw_preview: string;
      normalization: ConversationDecisionV3PolicyNormalizationResult | null;
      semanticValidation: ReturnType<typeof validateConversationDecisionV3Semantics> | null;
    };

function rawPreview(rawText: string): string {
  return rawText.slice(0, 200);
}

export function parseConversationDecisionV3Response(input: {
  rawText: string;
  adapterInput: ModelAdapterInput;
  origin: ConversationDecision["origin"];
}): ConversationDecisionV3ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(input.rawText);
  } catch {
    return {
      ok: false,
      error_code: "INVALID_JSON",
      raw_preview: rawPreview(input.rawText),
      normalization: null,
      semanticValidation: null,
    };
  }

  const shape = validateConversationDecisionV3Shape(value);
  if (!shape.ok) {
    return {
      ok: false,
      error_code: "SHAPE_INVALID",
      raw_preview: rawPreview(input.rawText),
      normalization: null,
      semanticValidation: null,
    };
  }

  const normalization = normalizeConversationDecisionV3MissingPolicy(value as ConversationDecisionV3, input.adapterInput);
  const evaluatedValue = normalization.decision ?? value;
  const semantics = validateConversationDecisionV3Semantics(
    evaluatedValue,
    buildConversationDecisionV3SemanticContext(input.adapterInput),
  );

  if (!semantics.ok) {
    return {
      ok: false,
      error_code: "SEMANTIC_INVALID",
      raw_preview: rawPreview(input.rawText),
      normalization,
      semanticValidation: semantics,
    };
  }

  const v3 = evaluatedValue as ConversationDecisionV3;
  return {
    ok: true,
    v3,
    decision: mapConversationDecisionV3ToBackendDecision(v3, input.origin),
    normalization,
    semanticValidation: semantics,
  };
}
