import OpenAI from "openai";

function errorRecord(error: unknown): Record<string, unknown> {
  return typeof error === "object" && error !== null ? error as Record<string, unknown> : {};
}

function typeOf(error: unknown): string {
  const record = errorRecord(error);
  const name = error instanceof Error ? error.name : "";
  const constructorName = error !== null && typeof error === "object"
    ? (error as { constructor?: { name?: unknown } }).constructor?.name
    : undefined;
  return [name, typeof constructorName === "string" ? constructorName : "", typeof record.type === "string" ? record.type : ""]
    .find((value) => value.length > 0)
    ?.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80) ?? "UnknownError";
}

function causeMetadata(error: unknown): Record<string, unknown> {
  const record = errorRecord(error);
  const cause = errorRecord(record.cause);
  const name = typeof cause.name === "string" ? cause.name : null;
  const constructorName = cause.constructor && typeof cause.constructor === "object"
    && typeof (cause.constructor as { name?: unknown }).name === "string"
    ? (cause.constructor as { name: string }).name
    : null;
  return {
    cause_type: name ?? constructorName,
    cause_http_status: typeof cause.status === "number" ? cause.status : null,
    cause_code: typeof cause.code === "string" ? cause.code : null,
    cause_category: typeof cause.type === "string" ? cause.type : null,
  };
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_RESPONSES_MODEL;
  if (!apiKey || !model) throw new Error("PROBE_CONFIG_MISSING");
  const client = new OpenAI({ apiKey });
  try {
    const response = await client.responses.create({
      model,
      store: false,
      input: "Reply with a single short acknowledgement.",
      max_output_tokens: 16,
    }, { signal: AbortSignal.timeout(30_000) });
    console.log(JSON.stringify({
      status: "SUCCESS",
      http_status: 200,
      response_status: typeof response.status === "string" ? response.status : "unknown",
      model_configured: true,
      raw_output_logged: false,
      secrets_printed: false,
    }));
  } catch (error) {
    const record = errorRecord(error);
    console.log(JSON.stringify({
      status: "FAILED",
      http_status: typeof record.status === "number" ? record.status : null,
      error_type: typeOf(error),
      error_code: typeof record.code === "string" ? record.code : null,
      error_category: typeof record.type === "string" ? record.type : null,
      ...causeMetadata(error),
      raw_output_logged: false,
      secrets_printed: false,
    }));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.log(JSON.stringify({ status: "FAILED", error_type: typeOf(error), raw_output_logged: false, secrets_printed: false }));
  process.exitCode = 1;
});
