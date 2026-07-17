import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadEnv } from "../../config/env.js";
import { buildAssistantRunContent } from "../../assistant/assistantRun.js";
import { parseAssistantResponseV1 } from "../../contracts/assistantResponseContract.js";
import { createTestEnv } from "../testDoubles.js";
import { isInboundDualWriteEnabled, isOutboundShadowEnabled, productionSafeModeDefaults } from "../../reliability/queueModes.js";
import { runGoldenConversationEvaluation } from "../../behavior/goldenConversations.js";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function filesUnder(dir: string): string[] {
  const root = join(process.cwd(), dir);
  return readdirSync(root).flatMap((entry) => {
    const full = join(root, entry);
    const rel = `${dir}/${entry}`.replaceAll("\\", "/");
    if (statSync(full).isDirectory()) return filesUnder(rel);
    return rel.endsWith(".ts") ? [rel] : [];
  });
}

function withEnv<T>(patch: Record<string, string | undefined>, run: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(patch)) {
    previous.set(key, process.env[key]);
    const value = patch[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("architecture seal invariants", () => {
  it("keeps provider, assistant id, and Responses API invariants", () => {
    const server = source("src/server.ts");
    const assistantClient = source("src/assistant/openaiAssistantClient.ts");

    expect(server).toContain("new OpenAIAssistantClient(env.openaiApiKey, env.openaiAssistantId)");
    expect(assistantClient).toContain("beta.threads.runs.createAndPoll");
    expect(assistantClient).not.toContain(".responses.");
    expect(`${server}\n${assistantClient}`).not.toMatch(/Claude|DeepSeek|OpenRouter|Kimi/i);
  });

  it("keeps knowledge and publish paths out of behavior profile", () => {
    const behaviorProfile = source("src/behavior/behaviorProfile.ts");
    const contextBuilder = source("src/behavior/contextBuilder.ts");

    expect(behaviorProfile).not.toMatch(/M9W5B8|NIVI|invite|payment|link_catalog/i);
    expect(contextBuilder).toContain("retrieved_knowledge_summary");
    expect(contextBuilder).not.toContain("publishLocalKnowledgeToOpenAI");
  });

  it("preserves contract v1, public reply only, and raw output fallback guard", () => {
    const handleIncoming = source("src/bridge/handleIncomingMessage.ts");
    const contract = parseAssistantResponseV1('{"contract_version":"1.0","reply":"ok","internal_boss_note":"operator"}');

    expect(contract.ok).toBe(true);
    expect(handleIncoming).toContain("parseAssistantResponseV1");
    expect(handleIncoming).toContain("parsed.value.reply");
    expect(handleIncoming).not.toContain("sendReply(message, rawAssistantResponse");
    expect(buildAssistantRunContent as unknown).toBeDefined();
  });

  it("preserves group, command, and behavior ordering before AI", () => {
    const handleIncoming = source("src/bridge/handleIncomingMessage.ts");
    const groupGateIndex = handleIncoming.indexOf('status: "group_ignored"');
    const commandIndex = handleIncoming.indexOf("handleOwnerCommand");
    const behaviorIndex = handleIncoming.indexOf("BEHAVIOR_STATE_LOADED");
    const modelExecutionIndex = handleIncoming.indexOf("modelExecutionService.execute");

    expect(groupGateIndex).toBeGreaterThan(0);
    expect(commandIndex).toBeGreaterThan(0);
    expect(behaviorIndex).toBeGreaterThan(commandIndex);
    expect(modelExecutionIndex).toBeGreaterThan(behaviorIndex);
    expect(handleIncoming).toContain("resolveBehaviorCanaryEligibility");
    expect(handleIncoming).toContain("if (behaviorEligibility.eligible)");
  });

  it("keeps bridge decoupled from direct assistant imports", () => {
    const bridgeSources = filesUnder("src/bridge")
      .filter((file) => !file.endsWith("openaiFileSearchPublisher.ts"))
      .map((file) => source(file))
      .join("\n");
    const handleIncoming = source("src/bridge/handleIncomingMessage.ts");

    expect(handleIncoming).not.toContain("runAssistantWithBackendContext");
    expect(handleIncoming).not.toContain("openaiAssistantClient");
    expect(handleIncoming).not.toContain("AssistantClient");
    expect(bridgeSources).not.toMatch(/from ["']openai["']/i);
    expect(handleIncoming).toContain("ModelExecutionService");
  });

  it("keeps reliability flags safe by default and shadow modes explicit", () => {
    const env = createTestEnv({
      webhookQueueMode: "dual_write",
      outboundQueueMode: "enqueue_shadow",
      fastAckEnabled: false,
      workersEnabled: false,
    });

    expect(isInboundDualWriteEnabled(env.webhookQueueMode)).toBe(true);
    expect(isOutboundShadowEnabled(env.outboundQueueMode)).toBe(true);
    expect(env.fastAckEnabled).toBe(false);
    expect(env.workersEnabled).toBe(false);
    expect(productionSafeModeDefaults().fastAckEnabled).toBe(false);
    expect(productionSafeModeDefaults().workersEnabled).toBe(false);
  });

  it("keeps behavior default false and rollback flag-off", () => {
    const env = withEnv({
      PORT: "3000",
      EVOLUTION_API_BASE_URL: "http://evolution.local",
      EVOLUTION_INSTANCE: "instance",
      EVOLUTION_API_KEY: "test",
      OPENAI_API_KEY: "test",
      OPENAI_ASSISTANT_ID: "asst_test",
      OWNER_PHONE_NUMBERS: "",
      MANAGER_PHONE_NUMBERS: "",
      SYSTEM_PROMPT_VERSION: "1.0.0",
      KNOWLEDGE_BASE_VERSION: "2026.07.04",
      BACKEND_CONTEXT_VERSION: "1.0",
      STATE_MACHINE_VERSION: "1.0",
      ASSISTANT_RESPONSE_CONTRACT_VERSION: "1.0",
      BEHAVIOR_ORCHESTRATOR_ENABLED: undefined,
      MODEL_ADAPTER_LAYER_ENABLED: undefined,
      FAST_ACK_ENABLED: undefined,
      WORKERS_ENABLED: undefined,
    }, () => loadEnv());

    expect(env.behaviorOrchestratorEnabled).toBe(false);
    expect(env.modelAdapterLayerEnabled).toBe(false);
    expect(env.fastAckEnabled).toBe(false);
    expect(env.workersEnabled).toBe(false);
  });

  it("keeps architecture logs and diagnostics sanitized by invariant", () => {
    const loggerSource = source("src/bridge/handleIncomingMessage.ts");
    const serverSource = source("src/server.ts");

    expect(loggerSource).not.toContain("full_prompt");
    expect(loggerSource).not.toContain("raw_text:");
    expect(serverSource).toContain("raw_text_logged: false");
    expect(serverSource).toContain("full_prompt_logged: false");
  });

  it("keeps golden synthetic canary gates passing", () => {
    const result = runGoldenConversationEvaluation();

    expect(result.behavior_average_score).toBeGreaterThanOrEqual(result.legacy_average_score);
    expect(result.hallucination_absent).toBe(true);
    expect(result.internal_leak_absent).toBe(true);
    expect(result.group_policy_preserved).toBe(true);
    expect(result.unauthorized_command_blocked).toBe(true);
  });

  it("keeps behavior layer provider agnostic and blocks OpenAI thread format leakage", () => {
    const behaviorSources = filesUnder("src/behavior").map((file) => source(file)).join("\n");
    const contextBuilder = source("src/behavior/contextBuilder.ts");

    expect(behaviorSources).not.toMatch(/from ["']openai["']/i);
    expect(behaviorSources).not.toMatch(/OpenAIAssistantClient|AssistantClient|createAndPoll|beta\.threads/i);
    expect(contextBuilder).not.toMatch(/threadId|assistant_id|messages\.create|runs\.create/i);
  });

  it("isolates provider-specific code to explicit adapter boundaries", () => {
    const adapterSources = filesUnder("src/modelAdapter")
      .filter((file) => !file.endsWith("AssistantAdapter.ts"))
      .filter((file) => !file.endsWith("ResponsesAdapter.ts"))
      .filter((file) => !file.endsWith("modelExecutionService.ts"))
      .map((file) => source(file))
      .join("\n");
    const assistantAdapter = source("src/modelAdapter/AssistantAdapter.ts");
    const responsesAdapter = source("src/modelAdapter/ResponsesAdapter.ts");
    const modelExecutionService = source("src/modelAdapter/modelExecutionService.ts");

    expect(adapterSources).not.toMatch(/assistant_id|beta\.threads|createAndPoll|\.responses\.|responses\.create/i);
    expect(assistantAdapter).toContain("buildAssistantRunContent");
    expect(assistantAdapter).toContain("parseAssistantResponseV1");
    expect(assistantAdapter).not.toContain(".responses.");
    expect(responsesAdapter).toContain("CONVERSATION_DECISION_V3_SCHEMA");
    expect(responsesAdapter).toContain("responses.create");
    expect(responsesAdapter).not.toMatch(/assistant_id|beta\.threads|createAndPoll/i);
    expect(modelExecutionService).toContain("adapter.run(input)");
    expect(modelExecutionService).not.toContain("runAssistantWithBackendContext");
    expect(modelExecutionService).toContain("legacy_assistant_boundary");
    expect(modelExecutionService).not.toContain("@ts-nocheck");
    expect(modelExecutionService).not.toContain(".responses.");
  });

  it("keeps Responses unselected by the primary factory and isolated to shadow runtime", () => {
    const designDocPath = join(process.cwd(), "docs/design/RESPONSES_ADAPTER_DESIGN_V1.md");
    const responsesAdapterPath = join(process.cwd(), "src/modelAdapter/ResponsesAdapter.ts");
    const factory = source("src/modelAdapter/modelAdapterFactory.ts");
    const primaryRuntimeSources = [
      ...filesUnder("src/modelAdapter")
        .filter((file) => !file.endsWith("ResponsesAdapter.ts"))
        .filter((file) => !file.endsWith("responsesShadowService.ts")),
      ...filesUnder("src/bridge"),
    ]
      .map((file) => source(file))
      .join("\n");
    const designDoc = readFileSync(designDocPath, "utf8");

    expect(existsSync(designDocPath)).toBe(true);
    expect(existsSync(responsesAdapterPath)).toBe(true);
    expect(factory).toContain("return new AssistantAdapter");
    expect(factory).not.toMatch(/ResponsesAdapter|MODEL_PROVIDER|responses\.create|\.responses\./i);
    expect(primaryRuntimeSources).not.toMatch(/MODEL_PROVIDER|responses\.create|\.responses\./i);
    expect(source("src/modelAdapter/responsesShadowService.ts")).toContain("outbound_allowed: false");
    expect(source("src/modelAdapter/responsesShadowService.ts")).toContain("state_writes_allowed: false");
    expect(source("src/modelAdapter/responsesShadowService.ts")).not.toMatch(/sendText|EvolutionApiSender|UserStateStore|MemoryStore|QueueStore/);
    expect(designDoc).toContain("SHADOW-WIRED / PRIMARY RUNTIME UNSELECTED");
    expect(designDoc).toContain("Breaking changes required: NO");
    expect(designDoc).not.toMatch(/sk-[A-Za-z0-9_-]+|@s\.whatsapp\.net|@g\.us|905\d{9}/);
  });
});
