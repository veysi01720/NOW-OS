# Human Handoff Mechanism Design

## Status

Design only. No runtime behavior, outbound sender, worker, database migration, or deployment is changed by this document.

## Current evidence

The canonical backend can produce a sanitized safe-fallback when a response cannot be safely completed. The current connection doctor reports inbound dual-write enabled, outbound queue mode off, workers disabled, and no recent provider-unavailable diagnostic event. Therefore this design must not assume that a production outbound queue is already available.

## Goal

Every fallback that means "a human/team must review this" must create an observable, deduplicated handoff record. The candidate-facing response remains safe and single-send. The owner receives a reliable notification through an explicitly approved channel.

## Proposed ownership

- Decision/validator layer: emits a typed handoff intent with a reason code, urgency, tenant, conversation key, and correlation id. It does not send WhatsApp messages.
- Backend handoff service: validates, deduplicates, redacts, persists, and assigns status: pending, acknowledged, resolved, or suppressed.
- Owner dashboard queue: canonical source of truth for review, audit, assignment, and resolution.
- Notification adapter: optional owner WhatsApp notification, enabled only after approval and only through the canonical outbound path with idempotency. It must never notify a group or candidate and must never contain raw PII in logs.
- Connection Doctor: exposes pending count, oldest age, last creation, last notification attempt, last successful notification, and degraded reason.

## Recommended rollout

1. Dashboard/persistent handoff record in shadow/no-outbound mode.
2. Owner dashboard alert and audit trail.
3. Optional owner WhatsApp notification behind a separate flag, explicit owner approval, cooldown, and deduplication key.
4. Reconciliation job only after queue/worker cutover is separately approved.

## Safety and idempotency

The deduplication key is derived from tenant, conversation key, reason code, and an event window. Raw phone, remote JID, group ID, message text, and model output are excluded from logs. A retry may update delivery status but must not create a second handoff or send a duplicate notification. Candidate-facing outbound remains exactly one message.

## Acceptance criteria

- Every qualifying fallback produces one sanitized handoff record.
- Non-human fallbacks do not create handoffs.
- Owner/manager/group authorization boundaries are enforced before creation.
- Dashboard history is append-only and auditable.
- Notification is disabled by default.
- No production outbound behavior changes before explicit approval.
- A kill switch suppresses notifications while retaining the handoff record.
- Failed notification is visible and retryable without duplicate sends.

## Decision required

Approve the dashboard-first design and separately decide whether owner WhatsApp notification is enabled after the persistent handoff record and no-outbound tests pass.
