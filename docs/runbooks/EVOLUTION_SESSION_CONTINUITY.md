# Evolution Session Continuity

This runbook covers the narrow continuity controls added for the canonical
`nowakami_bot` gateway.

## Runtime controls

- `EVOLUTION_AUTO_RECONNECT_ENABLED=true` enables bounded reconnect attempts.
- `EVOLUTION_RECONNECT_BASE_DELAY_MS=5000` starts exponential backoff.
- The monitor uses one in-flight lock and at most three attempts per hour.
- A `connection.update` close with status reason `401` is classified as a
  logout, persisted for the 24-hour connection-doctor metric, and creates a
  deduplicated `evolution_session_logout_401` human-handoff item.
- A normal `close` without reason `401` is not reported as a logout.

## Session integrity

When `EVOLUTION_SESSION_DATABASE_URL` is present, backend startup performs a
read-only count of Evolution `Session` rows joined to the configured
`Instance`. Only `nonempty`, `empty`, `error`, or `unavailable` is logged.
Credentials and row contents are never logged.

## Image pinning

The production Evolution image is pinned to the digest currently verified on
the VPS rather than the mutable `latest` tag. Any future Evolution upgrade
requires a separate staging and rollback decision; this change does not
upgrade the image.

## Explicitly deferred

Staging validation for a future Evolution version is intentionally deferred
until an upgrade is proposed.
