import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ModelAdapterCanaryApprovalStore } from "../../modelAdapter/modelAdapterCanaryApproval.js";
import { ModelAdapterCanaryControl } from "../../modelAdapter/modelAdapterCanaryControl.js";
import { ModelAdapterCanaryStateStore } from "../../modelAdapter/modelAdapterCanaryStateStore.js";
import { ModelAdapterCanaryThresholdEvaluator, type ModelAdapterCanaryTerminalObservation } from "../../modelAdapter/modelAdapterCanaryThresholds.js";
import type { Logger } from "../../observability/logger.js";

const cleanObservation = (): ModelAdapterCanaryTerminalObservation => ({
  unsafe_claim_count: 0,
  internal_or_raw_output_outbound_count: 0,
  sensitive_log_count: 0,
  unauthorized_path_count: 0,
  outbound_count_mismatch_count: 0,
  hash_mismatch_count: 0,
  invalid_transition_applied_count: 0,
  fake_link_promoted_count: 0,
  safe_fallback_count: 0,
  validator_reject_count: 0,
  schema_or_parse_reject_count: 0,
  final_provider_failure_count: 0,
  terminal_failure_count: 0,
  model_origin_accepted_count: 1,
  transient_retry_count: 0,
  latency_ms: 100,
  timeout_before_retry_count: 0,
});

describe("persistent model adapter canary 20-event window", () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it("survives restart, preserves idempotency, and reports event-level progress", () => {
    const directory = mkdtempSync(join(tmpdir(), "nowos-canary-state-"));
    directories.push(directory);
    const approvalPath = join(directory, "approval.json");
    const statePath = join(directory, "state.json");
    const approvals = new ModelAdapterCanaryApprovalStore(approvalPath);
    approvals.write({
      schema_version: 1,
      approval_id: "approval-1",
      approval_generation: "generation-1",
      approved: true,
      issued_by: "owner_dashboard_token",
      issued_at: "2026-07-18T12:00:00.000Z",
      expires_at: "2026-07-18T13:00:00.000Z",
      maximum_observed_messages: 20,
      scope: {
        tenant_id: "now_os",
        intents: ["candidate_first_contact", "greeting_or_first_contact"],
        traffic_percent: 10,
        channel: "private",
        sender_role: "candidate",
      },
      invalidated_at: null,
      invalidation_reason: null,
    });
    const now = () => new Date("2026-07-18T12:15:00.000Z");
    const logger = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as unknown as Logger;
    const createControl = () => new ModelAdapterCanaryControl(
      approvals,
      new ModelAdapterCanaryThresholdEvaluator(),
      logger,
      now,
      new ModelAdapterCanaryStateStore(statePath),
    );

    const firstProcess = createControl();
    for (let index = 1; index <= 7; index += 1) {
      expect(firstProcess.reserve(`event-${index}`)).toBe("reserved");
      expect(firstProcess.finalize(`event-${index}`, cleanObservation()).status).toBe("finalized");
    }
    expect(firstProcess.reserve("event-7")).toBe("duplicate");
    expect(firstProcess.snapshot()).toMatchObject({
      terminal_window_target: 20,
      terminal_window_progress: 7,
      terminal_window_complete: false,
      reservation_count: 7,
      result_totals: { model_origin_accepted_count: 7 },
    });

    const restartedProcess = createControl();
    expect(restartedProcess.snapshot()).toMatchObject({
      approval_valid: true,
      terminal_window_progress: 7,
      reservation_count: 7,
      result_totals: { model_origin_accepted_count: 7 },
    });
    expect(restartedProcess.reserve("event-7")).toBe("duplicate");
    for (let index = 8; index <= 20; index += 1) {
      expect(restartedProcess.reserve(`event-${index}`)).toBe("reserved");
      restartedProcess.finalize(`event-${index}`, cleanObservation());
    }
    expect(restartedProcess.snapshot()).toMatchObject({
      terminal_window_progress: 20,
      terminal_window_complete: true,
      terminal_observation_count: 20,
      result_totals: { model_origin_accepted_count: 20 },
    });

    const persistedText = readFileSync(statePath, "utf8");
    expect(persistedText).not.toContain("event-1");
    expect(persistedText).not.toMatch(/remoteJid|phone|raw_text|message_text/u);
    if (process.platform !== "win32") expect(statSync(statePath).mode & 0o777).toBe(0o600);
  });
});
