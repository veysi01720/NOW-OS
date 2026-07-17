import type { ConnectionHealthSnapshot } from "./connectionHealthMonitor.js";

export interface MigrationReadinessSnapshot {
  responses_shadow_ready: boolean;
  live_cutover_ready: boolean;
  reason_codes: string[];
  recommendation: string;
}

export function evaluateMigrationReadiness(
  snapshot: Pick<
    ConnectionHealthSnapshot,
    "last_reachability_ok" | "receiving_degraded" | "recent_inbound_observation" | "recent_send_observation"
  >,
): MigrationReadinessSnapshot {
  const reasons: string[] = [];
  if (snapshot.last_reachability_ok !== true) reasons.push("GATEWAY_REACHABILITY_NOT_CONFIRMED");
  if (snapshot.receiving_degraded) reasons.push("INBOUND_RECEIVING_DEGRADED");
  if (!snapshot.recent_inbound_observation) reasons.push("RECENT_INBOUND_NOT_CONFIRMED");

  const shadowReady = reasons.length === 0;
  const liveReasons = [...reasons];
  if (!snapshot.recent_send_observation) liveReasons.push("RECENT_SEND_NOT_CONFIRMED");

  return {
    responses_shadow_ready: shadowReady,
    live_cutover_ready: liveReasons.length === 0,
    reason_codes: [...new Set(liveReasons)],
    recommendation: shadowReady
      ? snapshot.recent_send_observation
        ? "Runtime observation gates are healthy."
        : "Shadow observation may proceed; confirm outbound before any live cutover."
      : "Keep migration flags off until gateway and recent inbound observation are healthy.",
  };
}
