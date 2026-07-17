export interface ThreadStore {
  get(key: string): string | undefined;
  set(key: string, threadId: string): void;
  getOrCreate(key: string, createThread: () => Promise<string>): Promise<string>;
}

export class InMemoryThreadStore implements ThreadStore {
  private readonly threads = new Map<string, string>();

  get(key: string): string | undefined {
    return this.threads.get(key);
  }

  set(key: string, threadId: string): void {
    this.threads.set(key, threadId);
  }

  async getOrCreate(key: string, createThread: () => Promise<string>): Promise<string> {
    const existing = this.get(key);
    if (existing !== undefined) {
      return existing;
    }

    const created = await createThread();
    this.set(key, created);
    return created;
  }
}
