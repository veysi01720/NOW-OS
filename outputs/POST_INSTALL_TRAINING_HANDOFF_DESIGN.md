# Post-Install Training Handoff Design

## Status and scope

Design only. No code, runtime flag, outbound sender, database migration, or
activation is introduced by this document. The static training number is
intentionally excluded; routing is decided per completed installation.

## Existing boundary

The current state machine derives `INSTALLATION_DONE` and then moves directly
to `TRAINING_READY` when `training_status=not_started`. The new behavior should
insert an explicit owner decision gate between those states rather than
silently starting training.

## Proposed state and ownership

On the installation-complete transition, create one durable handoff with
reason `post_install_training_gate` and move the candidate to
`TRAINING_PENDING_OWNER_APPROVAL`. The record should contain only sanitized
metadata: tenant, conversation key hash, installation event id, selected app,
created/expiry timestamps, decision status, and audit references. The
candidate state carries `training_gate_status=pending`, while training remains
`not_started`.

The state machine remains the sole owner of candidate transitions. The handoff
service owns persistence, deduplication, audit, and notification delivery. The
model/assistant must not interpret or approve the owner response.

## Owner notification

The existing dashboard-first handoff queue remains the source of truth. For
this reason only, the notification policy is enabled by default for the
`post_install_training_gate` reason, subject to the existing owner-private,
canonical-tenant, idempotent outbound path. Other handoff reasons retain their
existing opt-in behavior. The notification says an installation is complete
and requests a training decision; raw phone/JID, candidate text, secrets, and
internal notes are excluded from logs.

## Deterministic owner decisions

Only an authenticated owner private message can resolve this gate. The
command parser accepts:

- `evet eğitime geç`: append an audit event and transition to
  `TRAINING_READY`/`TRAINING_IN_PROGRESS` according to the existing training
  runner. The candidate then receives the normal app-specific training path.
- `hayır <numara>`: validate and normalize the explicitly supplied number,
  append an audit event, set the handoff decision to `redirected`, and send the
  candidate a concise message that they can contact that number. The actual
  number may be included in that candidate-facing message only because the
  owner explicitly supplied it; raw number values are never written to logs.
  The owner receives a sanitized confirmation and the dashboard records a
  masked/hash reference.

Ambiguous replies, manager/non-owner replies, group messages, wrong-tenant
messages, invalid numbers, and stale/expired approvals do not change state.
They create a safe operator-visible rejection/audit event where appropriate.

## Timeout and failure behavior

Expiry is a hold, not an implicit approval: the candidate remains in
`TRAINING_PENDING_OWNER_APPROVAL`, no training starts, and no number is sent.
A dashboard reminder may be shown, but an automatic training transition is
forbidden. Notification retries use the existing idempotency key and may not
create duplicate handoffs or duplicate candidate sends.

## Acceptance and rollback gates

Acceptance requires deterministic tests for installation completion, one
handoff per event, owner-only approval, explicit yes/no-number parsing, expiry
hold, invalid-number rejection, candidate single-send behavior, append-only
audit, and notification deduplication. The feature must remain behind a
default-off activation gate until these tests pass and an owner explicitly
activates it. Disabling the gate returns the old installation-to-training
behavior without deleting state or audit history; activation rollback restores
the previous state transition policy.

## Open decisions before implementation

1. Confirm the exact owner command spellings and accepted phone-number
   normalization rules.
2. Confirm the candidate-facing wording for a redirect.
3. Confirm whether the expiry needs a reminder schedule or only a dashboard
   pending state.
