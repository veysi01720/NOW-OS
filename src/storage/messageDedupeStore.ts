import type { ProcessedMessageMetadata } from "./types.js";

export interface MessageDedupeStore {
  isDuplicate(key: string): boolean;
  markSeen(key: string, metadata?: ProcessedMessageMetadata): void;
}

export class InMemoryMessageDedupeStore implements MessageDedupeStore {
  private readonly seen = new Map<string, number>();

  constructor(private readonly ttlMs = 10 * 60 * 1000) {}

  isDuplicate(key: string): boolean {
    this.prune();
    return this.seen.has(key);
  }

  markSeen(key: string, _metadata?: ProcessedMessageMetadata): void {
    this.prune();
    this.seen.set(key, Date.now() + this.ttlMs);
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.seen.entries()) {
      if (expiresAt <= now) {
        this.seen.delete(key);
      }
    }
  }
}
