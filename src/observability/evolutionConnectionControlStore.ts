import { dirname } from "node:path";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export type EvolutionConnectionAlarmKind =
  | "logged_out_401"
  | "repeated_refused_428"
  | "circuit_breaker_open"
  | "connection_recovered";

export interface EvolutionConnectionControlState {
  version: 1;
  attempt_timestamps: string[];
  cooldown_until: string | null;
  hard_stop_reason: "logged_out_401" | null;
  connecting_since: string | null;
  refused_since: string | null;
  refused_event_count: number;
  open_since: string | null;
  last_state: string | null;
  refused_attempted: boolean;
  connecting_attempted: boolean;
  incident_active: boolean;
  alarms_sent: EvolutionConnectionAlarmKind[];
}

const emptyState = (): EvolutionConnectionControlState => ({
  version: 1,
  attempt_timestamps: [],
  cooldown_until: null,
  hard_stop_reason: null,
  connecting_since: null,
  refused_since: null,
  refused_event_count: 0,
  open_since: null,
  last_state: null,
  refused_attempted: false,
  connecting_attempted: false,
  incident_active: false,
  alarms_sent: [],
});

export class PersistentEvolutionConnectionControlStore {
  private state: EvolutionConnectionControlState;

  constructor(private readonly path: string | undefined, private readonly now: () => Date = () => new Date()) {
    this.state = this.load();
  }

  snapshot(): EvolutionConnectionControlState {
    this.pruneAttempts();
    return structuredClone(this.state);
  }

  update(mutator: (state: EvolutionConnectionControlState) => void): EvolutionConnectionControlState {
    mutator(this.state);
    this.pruneAttempts();
    this.save();
    return this.snapshot();
  }

  recordAttempt(): EvolutionConnectionControlState {
    return this.update((state) => {
      state.attempt_timestamps.push(this.now().toISOString());
      state.incident_active = true;
    });
  }

  openCircuit(cooldownMs: number): EvolutionConnectionControlState {
    return this.update((state) => {
      state.cooldown_until = new Date(this.now().getTime() + cooldownMs).toISOString();
      state.incident_active = true;
    });
  }

  markAlarmSent(kind: EvolutionConnectionAlarmKind): void {
    this.update((state) => {
      if (!state.alarms_sent.includes(kind)) state.alarms_sent.push(kind);
    });
  }

  resetAfterStableOpen(recoveryAlarmDelivered: boolean): void {
    this.update((state) => {
      state.attempt_timestamps = [];
      state.cooldown_until = null;
      state.hard_stop_reason = null;
      state.connecting_since = null;
      state.refused_since = null;
      state.refused_event_count = 0;
      state.open_since = recoveryAlarmDelivered ? null : state.open_since;
      state.last_state = "open";
      state.refused_attempted = false;
      state.connecting_attempted = false;
      state.incident_active = !recoveryAlarmDelivered;
      if (recoveryAlarmDelivered) state.alarms_sent = [];
    });
  }

  private load(): EvolutionConnectionControlState {
    if (!this.path) return emptyState();
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Partial<EvolutionConnectionControlState>;
      return {
        ...emptyState(),
        ...parsed,
        version: 1,
        attempt_timestamps: Array.isArray(parsed.attempt_timestamps)
          ? parsed.attempt_timestamps.filter((value): value is string => typeof value === "string")
          : [],
        alarms_sent: Array.isArray(parsed.alarms_sent)
          ? parsed.alarms_sent.filter((value): value is EvolutionConnectionAlarmKind => (
              value === "logged_out_401"
              || value === "repeated_refused_428"
              || value === "circuit_breaker_open"
              || value === "connection_recovered"
            ))
          : [],
      };
    } catch {
      return emptyState();
    }
  }

  private pruneAttempts(): void {
    const cutoff = this.now().getTime() - 30 * 60 * 1000;
    this.state.attempt_timestamps = this.state.attempt_timestamps.filter((value) => Date.parse(value) >= cutoff);
  }

  private save(): void {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(this.state, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(temporaryPath, this.path);
  }
}
