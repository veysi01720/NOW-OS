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

const DECISION_V2_MARKER = "<conversation_decision_v2_instructions>";

const DECISION_V2_ADDITIONAL_INSTRUCTIONS = [
  "This run must ignore any older Assistant Response Contract v1 output format.",
  "Return ONLY a single valid JSON object for Conversation Decision v2.",
  "The top-level keys must include decision_version, intent, direct_question, reply, chosen_actions, state_patch, policy_facts_used, next_action, requires_escalation, escalation_reason, risk_flags, and self_check.",
  "The reply field must be an object with text, language, tone, and contains_question.",
  "Do not include contract_version, internal_boss_note, conversation_boss_note, markdown fences, or prose outside JSON.",
].join("\n");

function buildSyntheticContent(simulateDecisionV2: boolean): string {
  const placeholderTurns = Array.from({ length: 6 }, (_, i) =>
    `Turn ${i + 1}: [synthetic placeholder candidate/bot exchange text, no real data]`
  ).join("\n");
  const marker = simulateDecisionV2 ? `${DECISION_V2_MARKER}\ndecision_version 2.0\n` : "";
  return `${marker}${placeholderTurns}\nReply with a single short acknowledgement.`;
}

async function runOneTrial(
  client: OpenAI,
  trialIndex: number,
  assistantId: string,
  simulateDecisionV2: boolean
): Promise<Record<string, unknown>> {
  const start = Date.now();
  try {
    const thread = await client.beta.threads.create();
    const content = buildSyntheticContent(simulateDecisionV2);
    await client.beta.threads.messages.create(thread.id, {
      role: "user",
      content
    });
    const run = await client.beta.threads.runs.createAndPoll(thread.id, {
      assistant_id: assistantId,
      ...(simulateDecisionV2
        ? { additional_instructions: DECISION_V2_ADDITIONAL_INSTRUCTIONS }
        : {}),
      truncation_strategy: { type: "last_messages", last_messages: 10 }
    });
    return {
      trial: trialIndex,
      status: run.status === "completed" ? "SUCCESS" : "RUN_NOT_COMPLETED",
      duration_ms: Date.now() - start,
      ...runOutcomeMetadata(run),
      raw_output_logged: false,
      secrets_printed: false,
    };
  } catch (error) {
    const record = errorRecord(error);
    return {
      trial: trialIndex,
      status: "FAILED",
      duration_ms: Date.now() - start,
      http_status: typeof record.status === "number" ? record.status : null,
      error_type: typeOf(error),
      error_code: typeof record.code === "string" ? record.code : null,
      error_category: typeof record.type === "string" ? record.type : null,
      ...causeMetadata(error),
      raw_output_logged: false,
      secrets_printed: false,
    };
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  const assistantId = process.env.OPENAI_ASSISTANT_ID;
  if (!apiKey || !assistantId) throw new Error("PROBE_CONFIG_MISSING");
  const client = new OpenAI({ apiKey });
  const trials = Number.parseInt(process.env.TRIALS ?? "5", 10);
  const simulateDecisionV2 = process.env.SIMULATE_DECISION_V2 !== "0";

  const results: Record<string, unknown>[] = [];
  for (let i = 1; i <= trials; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const result = await runOneTrial(client, i, assistantId, simulateDecisionV2);
    console.log(JSON.stringify(result));
    results.push(result);
  }

  const durations = results.map((r) => r.duration_ms as number);
  const failures = results.filter((r) => r.status !== "SUCCESS");
  console.log(JSON.stringify({
    summary: true,
    trials,
    simulate_decision_v2: simulateDecisionV2,
    success_count: trials - failures.length,
    failure_count: failures.length,
    duration_ms_min: Math.min(...durations),
    duration_ms_max: Math.max(...durations),
    duration_ms_avg: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
    raw_output_logged: false,
    secrets_printed: false,
  }));
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.log(JSON.stringify({ status: "FAILED", error_type: typeOf(error), raw_output_logged: false, secrets_printed: false }));
  process.exitCode = 1;
});
