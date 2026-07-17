# Architecture Seal V1

## Main Runtime Flow

The production message path remains backend owned:

1. Webhook receives an inbound event.
2. Instance and authorization context are resolved.
3. Private/group policy is applied.
4. Deterministic command routing runs before any model call.
5. Mode routing and answer planning run in backend code.
6. Behavior orchestration may add context only when its feature flag is enabled.
7. Backend context is budgeted and sent through the current assistant run path.
8. Assistant Response Contract v1.0 is validated.
9. Only the public reply is sent outbound.

The assistant does not own authorization, command routing, tenant selection, state writes, queue decisions, or knowledge publishing.

## Queue And Reliability Status

Current reliability posture is shadow-first:

- Inbound queue can run in dual-write mode.
- Outbound queue can run in shadow enqueue mode.
- Queue-only cutover is not enabled.
- Fast ACK cutover is not enabled.
- Production workers are not enabled.

Queue-only and worker cutover require separate proof before activation.

## Behavior Orchestrator Status

Behavior orchestration is implemented and tested behind a feature flag.

- Default flag state: off.
- Rollback: set the flag off.
- Production rollout: not enabled.
- Internal canary: ready only in a controlled scope.

Behavior context is additive. It does not replace the backend context and does not change the response contract.

## Knowledge Publish Safety

Knowledge publish, vector updates, and assistant binding updates are separate controlled operations. Behavior orchestration does not publish knowledge, alter vector stores, or modify active knowledge content.

## Contract Safety

The current assistant response contract remains v1.0:

- `reply`
- `internal_boss_note`

Outbound messaging uses only `reply`. Internal notes are never sent to users or groups.

## Group And Command Boundary

Group and command rules remain deterministic:

- Group messages without an allowed prefix are safe-ignored.
- Unauthorized group commands do not reach the assistant.
- Owner and manager commands are routed by backend code.
- The assistant does not interpret or execute commands.

## Rollback Strategies

- Behavior rollback: feature flag off.
- Queue rollback: disable queue-only and worker cutover flags.
- Fast ACK rollback: keep fast ACK disabled.
- Knowledge rollback: restore previous binding through the publish rollback process.
- Webhook/session issues: diagnose via connection doctor before changing targets.

## No-Go Areas

The following are not part of this seal:

- Model/provider change
- Responses API migration
- Vector store mutation
- Knowledge content mutation
- DB reset
- Evolution instance deletion or recreation
- Webhook target change
- Fast ACK cutover
- Queue-only cutover
- Production worker side effects

## Canary Versus Production Rollout

Canary is limited validation under controlled scope. Production rollout means enabling behavior for normal traffic. This seal allows internal canary preparation only; it does not approve production rollout.
