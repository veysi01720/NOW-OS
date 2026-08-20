import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type DeliveryEventType =
  | "inbound_received"
  | "processing_terminal"
  | "handoff_recorded"
  | "outbound_queued"
  | "outbound_delivered"
  | "outbound_retry_scheduled"
  | "outbound_dead_letter";

export interface DeliveryEvent {
  event_id: string;
  event_type: DeliveryEventType;
  correlation_id: string;
  occurred_at: string;
  job_id?: string;
  purpose?: string;
  status?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export class DeliveryEventLedger {
  private events: DeliveryEvent[];

  constructor(private readonly filePath: string, private readonly maxEntries = 20_000) {
    this.events = this.load();
  }

  append(input: Omit<DeliveryEvent, "event_id" | "occurred_at"> & { occurred_at?: string }): DeliveryEvent {
    const event: DeliveryEvent = {
      ...input,
      event_id: randomUUID(),
      occurred_at: input.occurred_at ?? new Date().toISOString(),
      metadata: input.metadata ? { ...input.metadata } : undefined,
    };
    this.events.push(event);
    if (this.events.length > this.maxEntries) this.events = this.events.slice(-this.maxEntries);
    this.persist();
    return { ...event, metadata: event.metadata ? { ...event.metadata } : undefined };
  }

  list(): DeliveryEvent[] {
    return this.events.map((event) => ({ ...event, metadata: event.metadata ? { ...event.metadata } : undefined }));
  }

  private load(): DeliveryEvent[] {
    if (!existsSync(this.filePath)) return [];
    const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as unknown;
    if (!Array.isArray(parsed)) throw new Error("Invalid delivery event ledger schema");
    return parsed as DeliveryEvent[];
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp-${process.pid}`;
    writeFileSync(temporary, `${JSON.stringify(this.events, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, this.filePath);
    chmodSync(this.filePath, 0o600);
  }
}
