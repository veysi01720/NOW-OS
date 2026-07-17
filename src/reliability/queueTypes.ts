export type ReliabilityQueueName = "inbound" | "outbound";
export type ReliabilityJobStatus = "QUEUED" | "LEASED" | "PROCESSING" | "RETRY_WAIT" | "COMPLETED" | "DEAD_LETTER" | "IGNORED";

export interface ReliabilityQueueJob {
  job_id: string;
  idempotency_key: string;
  tenant_id: string;
  conversation_key_hash: string;
  source_event_hash: string;
  event_type: string;
  enqueue_sequence: number;
  attempt_count: number;
  available_at: string;
  lease_until: string | null;
  status: ReliabilityJobStatus;
  created_at: string;
  updated_at: string;
  payload: Record<string, unknown>;
  locked_by?: string | null;
  last_error?: string | null;
  max_attempts?: number;
}

export interface EnqueueReliabilityJobInput {
  queue_name: ReliabilityQueueName;
  idempotency_key: string;
  tenant_id: string;
  conversation_key_hash: string;
  source_event_hash: string;
  event_type: string;
  payload: Record<string, unknown>;
  max_attempts?: number;
  available_at?: string;
}

export interface QueueBacklogSnapshot {
  inbound_queue_pending: number;
  outbound_queue_pending: number;
  dead_letter_count: number;
  failed_count: number;
  processing_count: number;
  backlog_alarm: boolean;
  dead_letter_alarm: boolean;
}

export interface ReliabilityQueueStore {
  enqueue(input: EnqueueReliabilityJobInput): ReliabilityQueueJob;
  claimNext(queueName: ReliabilityQueueName, workerId: string, now?: Date): ReliabilityQueueJob | null;
  markDone(jobId: string, now?: Date): void;
  markFailed(jobId: string, error: string, options?: { permanent?: boolean; now?: Date; backoffMs?: number }): ReliabilityQueueJob;
  reclaimStaleLocks(staleMs: number, now?: Date): number;
  counts(): QueueBacklogSnapshot;
  listJobs(): ReliabilityQueueJob[];
}
