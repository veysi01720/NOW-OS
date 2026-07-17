export type ModelExecutionErrorCode =
  | "TIMEOUT"
  | "CANCELLED"
  | "RATE_LIMITED"
  | "AUTHENTICATION_FAILED"
  | "PROVIDER_UNAVAILABLE"
  | "MALFORMED_RESPONSE"
  | "EMPTY_RESPONSE"
  | "CONTRACT_VALIDATION_FAILED"
  | "UNKNOWN_PROVIDER_ERROR";

export interface NormalizedModelExecutionError {
  code: ModelExecutionErrorCode;
  retryable: boolean;
  safeMessage: string;
  causeCategory?: string;
}

export class ModelExecutionError extends Error {
  readonly normalized: NormalizedModelExecutionError;

  constructor(normalized: NormalizedModelExecutionError) {
    super(`Model execution failed: ${normalized.code}`);
    this.name = "ModelExecutionError";
    this.normalized = normalized;
  }
}

function statusFromUnknown(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const record = error as Record<string, unknown>;
  const status = record.status ?? record.statusCode ?? record.code;
  if (typeof status === "number") return status;
  if (typeof status === "string" && /^\d+$/.test(status)) return Number(status);
  return undefined;
}

export function normalizeModelExecutionError(error: unknown): NormalizedModelExecutionError {
  if (error instanceof ModelExecutionError) return error.normalized;

  if (error instanceof DOMException && error.name === "AbortError") {
    return {
      code: "CANCELLED",
      retryable: false,
      safeMessage: "Model execution was cancelled.",
      causeCategory: "abort_signal",
    };
  }

  const status = statusFromUnknown(error);
  if (status === 401 || status === 403) {
    return {
      code: "AUTHENTICATION_FAILED",
      retryable: false,
      safeMessage: "Model provider authentication failed.",
      causeCategory: "provider_auth",
    };
  }
  if (status === 408 || status === 429) {
    return {
      code: "RATE_LIMITED",
      retryable: true,
      safeMessage: "Model provider rate limited the request.",
      causeCategory: "provider_rate_limit",
    };
  }
  if (status !== undefined && status >= 500) {
    return {
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
      safeMessage: "Model provider is unavailable.",
      causeCategory: "provider_unavailable",
    };
  }

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("rate_limit") || message.includes("rate limit")) {
    return {
      code: "RATE_LIMITED",
      retryable: true,
      safeMessage: "Model provider rate limited the request.",
      causeCategory: "provider_rate_limit",
    };
  }
  if (message.includes("unauthorized") || message.includes("authentication") || message.includes("permission")) {
    return {
      code: "AUTHENTICATION_FAILED",
      retryable: false,
      safeMessage: "Model provider authentication failed.",
      causeCategory: "provider_auth",
    };
  }
  if (message.includes("unavailable") || message.includes("econnreset") || message.includes("network")) {
    return {
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
      safeMessage: "Model provider is unavailable.",
      causeCategory: "provider_unavailable",
    };
  }

  return {
    code: "UNKNOWN_PROVIDER_ERROR",
    retryable: false,
    safeMessage: "Model execution failed.",
    causeCategory: "unknown",
  };
}
