export const RELIABILITY_QUEUE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS reliability_jobs (
  job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  tenant_id text NOT NULL,
  conversation_key_hash text NOT NULL,
  source_event_hash text NOT NULL,
  event_type text NOT NULL,
  enqueue_sequence bigserial NOT NULL,
  status text NOT NULL CHECK (status IN ('QUEUED', 'LEASED', 'PROCESSING', 'RETRY_WAIT', 'COMPLETED', 'DEAD_LETTER', 'IGNORED')),
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_until timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS reliability_jobs_pickup_idx
  ON reliability_jobs (status, available_at, enqueue_sequence);

CREATE INDEX IF NOT EXISTS reliability_jobs_conversation_idx
  ON reliability_jobs (conversation_key_hash, status, enqueue_sequence);

CREATE INDEX IF NOT EXISTS reliability_jobs_lease_idx
  ON reliability_jobs (lease_until);

CREATE TABLE IF NOT EXISTS outbound_ledger (
  outbound_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL UNIQUE,
  tenant_id text NOT NULL,
  conversation_key_hash text NOT NULL,
  reply_hash text NOT NULL,
  send_status text NOT NULL CHECK (send_status IN ('PENDING', 'SENDING', 'SENT', 'SEND_UNKNOWN', 'RETRY_WAIT', 'DEAD_LETTER')),
  provider_message_id_hash text,
  attempt_count integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  last_error_code text
);
CREATE INDEX IF NOT EXISTS outbound_ledger_diagnostic_idx ON outbound_ledger (conversation_key_hash, reply_hash);
`;

export function pickupSql(): string {
  return `
WITH active_conversations AS (
  SELECT conversation_key_hash
  FROM reliability_jobs
  WHERE status IN ('LEASED', 'PROCESSING')
),
picked AS (
  SELECT job_id
  FROM reliability_jobs
  WHERE status IN ('QUEUED', 'RETRY_WAIT')
    AND available_at <= now()
    AND conversation_key_hash NOT IN (SELECT conversation_key_hash FROM active_conversations)
  ORDER BY enqueue_sequence ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
UPDATE reliability_jobs
SET status = 'LEASED',
    attempt_count = attempt_count + 1,
    lease_owner = $1,
    lease_until = now() + interval '1 minute',
    updated_at = now()
WHERE job_id IN (SELECT job_id FROM picked)
RETURNING *;
`;
}
