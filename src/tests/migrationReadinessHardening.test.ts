import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAuthorityContext } from "../bridge/authorityContext.js";
import { resolveConversationModelRoute } from "../bridge/modelRoutingPolicy.js";
import type { NormalizedIncomingMessage } from "../bridge/normalizeEvolutionMessage.js";
import { evaluateMigrationReadiness } from "../observability/migrationReadiness.js";
import { ConnectionHealthMonitor } from "../observability/connectionHealthMonitor.js";
import { applyUserStateTransition } from "../storage/userStateTransitionBoundary.js";
import { defaultUserState, type UserState, type UserStateStore } from "../storage/types.js";
import { createSilentLogger } from "./testDoubles.js";

function message(phoneNumber: string, chatType: "private" | "group" = "private"): NormalizedIncomingMessage {
  return {
    correlation_id: "corr_hardening",
    sender_id: "safe_sender",
    phone_number: phoneNumber,
    remote_jid: chatType === "group" ? "safe_group_ref" : "safe_private_ref",
    message_id: "safe_message_ref",
    message_type: "conversation",
    text: "safe fixture",
    chat_type: chatType,
    is_from_me: false,
    is_group: chatType === "group",
    received_at: "2026-07-15T00:00:00.000Z",
  };
}

class RecordingStateStore implements UserStateStore {
  state = defaultUserState();
  updates = 0;

  getOrCreateState(): UserState {
    return this.state;
  }

  updateState(_userId: string, state: UserState): void {
    this.updates += 1;
    this.state = state;
  }
}

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function productionTypescriptFiles(dir: string): string[] {
  const root = join(process.cwd(), dir);
  return readdirSync(root).flatMap((entry) => {
    const absolute = join(root, entry);
    const relative = `${dir}/${entry}`.replaceAll("\\", "/");
    if (statSync(absolute).isDirectory()) return productionTypescriptFiles(relative);
    return relative.endsWith(".ts") && !relative.includes("/tests/") ? [relative] : [];
  });
}

describe("Package 04B migration readiness hardening", () => {
  it("resolves backend authority without trusting message claims", () => {
    const env = { ownerPhoneNumbers: ["111"], managerPhoneNumbers: ["222"] };

    expect(resolveAuthorityContext(message("111"), env)).toMatchObject({
      sender_role: "owner",
      whitelist_match: true,
      authority_source: "backend_whitelist",
    });
    expect(resolveAuthorityContext(message("333"), env)).toMatchObject({
      sender_role: "candidate",
      whitelist_match: false,
    });
  });

  it("enforces one candidate state-write boundary and blocks wrong authority", () => {
    const store = new RecordingStateStore();
    const current = defaultUserState();
    const next = { ...current, age: 27, missing_fields: ["gender", "daily_hours"] };

    const denied = applyUserStateTransition({
      store,
      conversationKey: "safe_key",
      currentState: current,
      nextState: next,
      source: "candidate_intake",
      authority: {
        sender_role: "owner",
        chat_type: "private",
        authority_source: "backend_whitelist",
        whitelist_match: true,
        privileged: true,
      },
    });
    expect(denied).toEqual({ applied: false, reason: "authority_denied" });
    expect(store.updates).toBe(0);

    const applied = applyUserStateTransition({
      store,
      conversationKey: "safe_key",
      currentState: current,
      nextState: next,
      source: "candidate_intake",
      authority: {
        sender_role: "candidate",
        chat_type: "private",
        authority_source: "backend_whitelist",
        whitelist_match: false,
        privileged: false,
      },
    });
    expect(applied).toEqual({ applied: true, reason: "applied" });
    expect(store.updates).toBe(1);
  });

  it.each([
    ["owner", "private"],
    ["manager", "private"],
    ["unknown", "private"],
    ["candidate", "group"],
  ] as const)("denies candidate state writes for %s in %s scope", (senderRole, chatType) => {
    const store = new RecordingStateStore();
    const current = defaultUserState();
    const result = applyUserStateTransition({
      store,
      conversationKey: "safe_key",
      currentState: current,
      nextState: { ...current, age: 27 },
      source: "conversation_decision_v2",
      authority: {
        sender_role: senderRole,
        chat_type: chatType,
        authority_source: "backend_whitelist",
        whitelist_match: senderRole === "owner" || senderRole === "manager",
        privileged: senderRole === "owner" || senderRole === "manager",
      },
    });

    expect(result.reason).toBe("authority_denied");
    expect(store.updates).toBe(0);
  });

  it("locks the V1/V2 routing matrix", () => {
    expect(resolveConversationModelRoute({
      senderRole: "candidate",
      chatType: "private",
      conversationDecisionV2Enabled: true,
      behaviorEligible: false,
    })).toBe("conversation_decision_v2");
    expect(resolveConversationModelRoute({
      senderRole: "owner",
      chatType: "private",
      conversationDecisionV2Enabled: true,
      behaviorEligible: true,
    })).toBe("assistant_response_v1_behavior");
    expect(resolveConversationModelRoute({
      senderRole: "manager",
      chatType: "private",
      conversationDecisionV2Enabled: true,
      behaviorEligible: false,
    })).toBe("assistant_response_v1_legacy");
  });

  it("requires healthy reachability and inbound observation before Responses shadow", () => {
    expect(evaluateMigrationReadiness({
      last_reachability_ok: true,
      receiving_degraded: false,
      recent_inbound_observation: true,
      recent_send_observation: false,
    })).toMatchObject({
      responses_shadow_ready: true,
      live_cutover_ready: false,
      reason_codes: ["RECENT_SEND_NOT_CONFIRMED"],
    });
    expect(evaluateMigrationReadiness({
      last_reachability_ok: true,
      receiving_degraded: true,
      recent_inbound_observation: false,
      recent_send_observation: true,
    })).toMatchObject({
      responses_shadow_ready: false,
      live_cutover_ready: false,
    });
  });

  it("projects migration readiness through the connection doctor snapshot", async () => {
    let now = new Date("2026-07-15T00:00:00.000Z");
    const monitor = new ConnectionHealthMonitor({
      evolutionInstance: "fixture_instance",
      evolutionApiBaseUrl: "http://fixture.invalid",
      evolutionApiKey: "fixture_key",
      logger: createSilentLogger(),
      now: () => now,
      fetchImpl: async () => new Response(null, { status: 200 }),
    });

    await monitor.runReachabilityCheck("startup");
    monitor.recordInboundConfirmed({ correlation_id: "safe_ref" });
    let snapshot = monitor.snapshot();
    expect(snapshot.migration_readiness).toMatchObject({
      responses_shadow_ready: true,
      live_cutover_ready: false,
    });

    now = new Date("2026-07-15T00:00:01.000Z");
    monitor.recordSendConfirmed({ correlation_id: "safe_ref" });
    snapshot = monitor.snapshot();
    expect(snapshot.migration_readiness).toMatchObject({
      responses_shadow_ready: true,
      live_cutover_ready: true,
      reason_codes: [],
    });
  });

  it("keeps production authority resolution and state persistence behind one boundary", () => {
    const handler = source("src/bridge/handleIncomingMessage.ts");
    const contextBuilder = source("src/bridge/buildBackendContext.ts");
    const intake = source("src/bridge/candidateIntakeStateMachine.ts");
    const productionSources = productionTypescriptFiles("src")
      .filter((file) => !file.endsWith("storage/persistentJsonStore.ts"))
      .filter((file) => !file.endsWith("storage/userStateTransitionBoundary.ts"))
      .filter((file) => !file.endsWith("storage/types.ts"))
      .map(source)
      .join("\n");

    expect(handler.match(/resolveAuthorityContext\(/g)).toHaveLength(1);
    expect(handler).toContain("authorityContext");
    expect(contextBuilder).not.toContain("resolveSenderRole");
    expect(intake).not.toContain("resolveSenderRole");
    expect(productionSources).not.toContain(".updateState(");
  });
});
