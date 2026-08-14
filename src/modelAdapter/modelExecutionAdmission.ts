export interface ModelExecutionAdmissionSnapshot {
  max_concurrent: number;
  active: number;
  queued: number;
  completed: number;
}

type Release = () => void;

export class ModelExecutionAdmission {
  private active = 0;
  private completed = 0;
  private readonly waiters: Array<(release: Release) => void> = [];

  constructor(private readonly maxConcurrent = 64) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) throw new Error("MODEL_EXECUTION_ADMISSION_LIMIT_INVALID");
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await task();
    } finally {
      release();
    }
  }

  snapshot(): ModelExecutionAdmissionSnapshot {
    return { max_concurrent: this.maxConcurrent, active: this.active, queued: this.waiters.length, completed: this.completed };
  }

  private acquire(): Promise<Release> {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return Promise.resolve(() => this.release());
    }
    return new Promise<Release>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    this.completed += 1;
    const next = this.waiters.shift();
    if (next) {
      next(() => this.release());
      return;
    }
    this.active -= 1;
  }
}
