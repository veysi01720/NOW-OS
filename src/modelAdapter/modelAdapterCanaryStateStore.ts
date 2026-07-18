import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ModelAdapterCanaryTerminalObservation, ModelAdapterCanaryThresholdId } from "./modelAdapterCanaryThresholds.js";

export interface PersistentCanaryReservation {
  event_key_hash: string;
  finalized: boolean;
}

export interface PersistentCanaryObservation {
  observed_at: string;
  metrics: ModelAdapterCanaryTerminalObservation;
}

export interface ModelAdapterCanaryPersistentState {
  schema_version: 1;
  approval_generation: string | null;
  stop_latched: boolean;
  stop_reason: ModelAdapterCanaryThresholdId | null;
  reservations: PersistentCanaryReservation[];
  observations: PersistentCanaryObservation[];
  terminal_observation_count: number;
  result_totals: {
    unsafe_claim_count: number;
    safe_fallback_count: number;
    validator_reject_count: number;
    schema_or_parse_reject_count: number;
    final_provider_failure_count: number;
    model_origin_accepted_count: number;
  };
  window_started_at: string | null;
  last_terminal_at: string | null;
  updated_at: string;
}

export function emptyModelAdapterCanaryPersistentState(now: Date = new Date()): ModelAdapterCanaryPersistentState {
  return {
    schema_version: 1,
    approval_generation: null,
    stop_latched: false,
    stop_reason: null,
    reservations: [],
    observations: [],
    terminal_observation_count: 0,
    result_totals: {
      unsafe_claim_count: 0,
      safe_fallback_count: 0,
      validator_reject_count: 0,
      schema_or_parse_reject_count: 0,
      final_provider_failure_count: 0,
      model_origin_accepted_count: 0,
    },
    window_started_at: null,
    last_terminal_at: null,
    updated_at: now.toISOString(),
  };
}

export class ModelAdapterCanaryStateStore {
  constructor(private readonly filePath: string) {}

  read(now: Date = new Date()): ModelAdapterCanaryPersistentState {
    try {
      if (!existsSync(this.filePath)) return emptyModelAdapterCanaryPersistentState(now);
      const value = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<ModelAdapterCanaryPersistentState>;
      if (
        value.schema_version !== 1
        || !Array.isArray(value.reservations)
        || !Array.isArray(value.observations)
        || typeof value.terminal_observation_count !== "number"
        || typeof value.result_totals !== "object"
        || value.result_totals === null
      ) return emptyModelAdapterCanaryPersistentState(now);
      return value as ModelAdapterCanaryPersistentState;
    } catch {
      return emptyModelAdapterCanaryPersistentState(now);
    }
  }

  write(state: ModelAdapterCanaryPersistentState): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    writeFileSync(temporary, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, this.filePath);
    chmodSync(this.filePath, 0o600);
  }
}
