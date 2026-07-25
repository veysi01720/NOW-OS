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

function runOutcomeMetadata(run: { status?: string; last_error?: unknown; incomplete_details?: unknown } | undefined): Record<string, unknown> {
  const lastError = errorRecord(run?.last_error);
  return {
    run_status: run?.status ?? null,
    run_last_error_code: typeof lastError.code === "string" ? lastError.code : null,
    run_incomplete_details_present: run?.incomplete_details != null,
  };
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  const assistantId = process.env.OPENAI_ASSISTANT_ID;
  if (!apiKey || !assistantId) throw new Error("PROBE_CONFIG_MISSING");
  const client = new OpenAI({ apiKey });
  const start = Date.now();
  try {
    const thread = await client.beta.threads.create();
    await client.beta.threads.messages.create(thread.id, {
      role: "user",
      content: "Reply with a single short acknowledgement."
    });
    const run = await client.beta.threads.runs.createAndPoll(thread.id, {
      assistant_id: assistantId,
    });
    console.log(JSON.stringify({
      status: run.status === "completed" ? "SUCCESS" : "RUN_NOT_COMPLETED",
      duration_ms: Date.now() - start,
      ...runOutcomeMetadata(run),
      raw_output_logged: false,
      secrets_printed: false,
    }));
    if (run.status !== "completed") process.exitCode = 1;
  } catch (error) {
    const record = errorRecord(error);
    console.log(JSON.stringify({
      status: "FAILED",
      duration_ms: Date.now() - start,
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
