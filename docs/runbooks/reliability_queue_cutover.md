# Reliability Queue Cutover Runbook

## Current State

The reliability layer is in safe shadow posture:

- Inbound dual-write may be used for observation.
- Outbound shadow enqueue may be used for observation.
- Queue-only mode is off.
- Fast ACK is off.
- Production workers are off.

## Why Queue-Only Is Off

Queue-only changes webhook acknowledgment behavior and processing ownership. It requires evidence that jobs are durable, workers drain reliably, duplicate processing is blocked, and dead-letter alarms are operational.

## Why Fast ACK Is Off

Fast ACK can hide processing failures from the upstream gateway. It should only be enabled after queue durability, worker monitoring, and rollback checks are proven.

## Why Production Workers Are Off

Workers can create side effects such as outbound sends. Production worker cutover requires controlled proof that retry, backoff, dead-letter, and idempotency behavior are correct.

## Required Proof Before Queue-Only

- Durable queue storage is ready.
- Duplicate webhook processing is blocked.
- Worker crash recovery is tested.
- Retry and dead-letter behavior is tested.
- Connection doctor shows queue backlog and dead-letter state.
- Rollback to legacy sync flow is documented.

## Required Proof Before Fast ACK

- Queue-only proof is complete.
- Upstream retry behavior is understood.
- Dead-letter alerting is operational.
- Operator runbook exists.

## Rollback

- Set webhook queue mode back to off or dual-write.
- Disable fast ACK.
- Disable production workers.
- Keep the legacy synchronous path active.

Do not reset the database as part of queue rollback.
