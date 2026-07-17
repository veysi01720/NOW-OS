import Fastify from "fastify";
import { registerConnectionDoctorRoute } from "../server.js";
import type { ConnectionHealthSnapshot } from "../observability/connectionHealthMonitor.js";

describe("connection doctor route", () => {
  it("returns sanitized connection health fields", async () => {
    const app = Fastify({ logger: false });
    const snapshot: ConnectionHealthSnapshot = {
      evolution_instance: "nowakademi_bot",
      inbound_queue_mode: "dual_write",
      outbound_queue_mode: "enqueue_shadow",
      fast_ack_enabled: false,
      workers_enabled: false,
      last_inbound_confirmed_at: "2026-07-10T10:00:00.000Z",
      last_send_confirmed_at: "2026-07-10T10:00:01.000Z",
      last_queue_write_at: "2026-07-10T10:00:03.000Z",
      last_queue_write_error: null,
      last_worker_pickup_at: "2026-07-10T10:00:04.000Z",
      last_worker_error: null,
      receiving_degraded: false,
      degraded_reason: null,
      recent_inbound_observation: true,
      recent_send_observation: true,
      degraded_threshold_seconds: 600,
      last_reachability_check_at: "2026-07-10T10:00:02.000Z",
      last_reachability_ok: true,
      last_reachability_status: 200,
      last_reachability_error: null,
      recommended_action: "No operator action required.",
      diagnosis: "Connection appears healthy.",
      behavior_tenant_canary_available: false,
      behavior_tenant_canary_enabled: false,
      behavior_tenant_canary_allowed_tenant_count: 0,
    };

    registerConnectionDoctorRoute(app, { snapshot: () => snapshot }, { behaviorOrchestratorEnabled: false });

    const response = await app.inject({ method: "GET", url: "/healthz/connection-doctor" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        status: "ok",
        service: "now-os",
        connection: snapshot,
        behavior: {
          behavior_orchestrator_enabled_default: false,
          behavior_orchestrator_enabled: false,
          behavior_orchestrator_global_enabled: false,
          behavior_canary_mode: "off",
          behavior_tenant_canary_enabled: false,
          behavior_tenant_allowlist_configured: false,
          behavior_internal_scope_configured: false,
          behavior_default_deny: true,
          behavior_production_global_active: false,
          behavior_canary_scope_supported: true,
          behavior_last_objective: "not_tracked",
          behavior_last_stage_transition_status: "not_tracked",
          behavior_recent_context_budget_applied: false,
          behavior_golden_score_latest: 0.95,
          behavior_quality_contract_version: "1.0",
          behavior_quality_contract_available: true,
          behavior_golden_suite_available: true,
          behavior_repetition_control_available: true,
          behavior_context_continuity_available: true,
          behavior_escalation_policy_available: true,
          behavior_production_enabled: false,
          behavior_canary_observability_available: true,
          behavior_canary_correlation_available: true,
          behavior_canary_rollback_ready: true,
          behavior_last_terminal_outcome_available: true,
          behavior_sensitive_content_exposed: false,
          rollback_mode: "flag_off",
          production_canary_ready: false,
        },
        model_adapter: {
          model_adapter_layer_global_enabled: false,
          model_adapter_canary_mode: "off",
          model_adapter_canary_scope_supported: true,
          model_adapter_current_decision: {
            use_adapter_layer: false,
            reason: "disabled_mode_off",
            canary_scope: "off",
          },
          model_adapter_selected_adapter: "assistant_adapter",
          model_adapter_provider: "openai_assistant",
          model_adapter_last_success_at: null,
          model_adapter_last_error_class: "none",
          model_execution_last_error_code: "none",
          model_execution_timeout_supported: true,
          model_execution_timeout_enabled: false,
          model_execution_timeout_ms_configured: false,
          model_execution_cancellation_supported: true,
          model_execution_error_normalization: true,
          adapter_abort_propagation_supported: false,
          late_result_ignored: false,
          model_adapter_rollback_method: "FLAG_OFF",
          assistant_id_changed: false,
          provider_changed: false,
          responses_api_used: false,
        },
        model_adapter_contract: {
          model_adapter_contract_version: "1.0",
          model_adapter_contract_tests_available: true,
          active_adapter_name: "assistant_adapter",
          adapter_layer_enabled: false,
          adapter_canary_mode: "off",
          provider_specific_details_exposed: false,
        },
        model_execution_resilience: {
          model_execution_timeout_supported: true,
          model_execution_timeout_enabled: false,
          model_execution_timeout_ms_configured: false,
          model_execution_cancellation_supported: true,
          model_execution_error_normalization: true,
          adapter_abort_propagation_supported: false,
          late_result_ignored: false,
          raw_timeout_value_exposed: false,
          provider_details_exposed: false,
        },
        adapter_canary: {
          live_owner_canary_status: "OWNER_SKIPPED",
          synthetic_adapter_canary_status: "REPLAY_HARNESS_AVAILABLE",
          adapter_global_default: false,
          ready_for_adapter_default_on: false,
          ready_for_responses_adapter_design: true,
          rollback_method: "FLAG_OFF",
        },
        safety: {
          provider_changed: false,
          assistant_id_changed: false,
          contract_version: "1.0",
          public_reply_only: true,
          raw_text_logged: false,
          full_prompt_logged: false,
          responses_api_used: false,
        },
      }),
    );
    expect(response.body).not.toContain("@s.whatsapp.net");
    expect(response.body).not.toContain("@g.us");
    expect(response.json().responses_shadow).toMatchObject({
      enabled: false,
      mode: "off",
      default_off: true,
      primary_path_unchanged: true,
      outbound_allowed: false,
      state_writes_allowed: false,
      last_status: "never_run",
    });

    await app.close();
  });

  it("reports sanitized Responses shadow observations without provider content", async () => {
    const app = Fastify({ logger: false });
    registerConnectionDoctorRoute(app, { snapshot: () => ({}) }, {
      responsesShadowSnapshot: () => ({
        enabled: true,
        mode: "tenant_allowlist",
        default_off: true,
        primary_path_unchanged: true,
        outbound_allowed: false,
        state_writes_allowed: false,
        last_status: "valid",
        last_reason: "validated",
        last_observed_at: "2026-07-15T01:00:00.000Z",
        last_schema_valid: true,
        last_semantic_valid: true,
        last_transition_prep_valid: true,
        last_role_match: true,
        last_reply_present: true,
        last_latency_ms: 120,
        observations_total: 1,
        valid_total: 1,
        invalid_total: 0,
        provider_error_total: 0,
        timeout_total: 0,
      }),
    });

    const response = await app.inject({ method: "GET", url: "/healthz/connection-doctor" });
    expect(response.statusCode).toBe(200);
    expect(response.json().responses_shadow).toMatchObject({
      last_status: "valid",
      observations_total: 1,
      outbound_allowed: false,
      state_writes_allowed: false,
    });
    expect(response.body).not.toMatch(/@s\.whatsapp\.net|@g\.us|905\d{9}|secret provider content/i);
    await app.close();
  });
});
