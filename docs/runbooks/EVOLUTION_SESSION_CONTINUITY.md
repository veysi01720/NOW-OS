# Evolution Session Continuity

This runbook covers the narrow continuity controls added for the canonical
`nowakami_bot` gateway.

## Runtime controls

- `EVOLUTION_AUTO_RECONNECT_ENABLED=true` enables only the bounded `428` and
  long-`connecting` recovery paths. It never performs logout or pairing.
- A `401` (`loggedOut`) is a hard stop. Automatic reconnect is forbidden until
  an owner explicitly requests recovery.
- A `428` waits at least 10 minutes and receives one connect request for that
  refused episode. A `connecting` state waits at least 5 minutes and receives
  one connect request for that episode.
- Automatic and dashboard-owner manual operations share one in-flight lock and
  the same persistent breaker: at most two attempts in a rolling 30-minute
  window, followed by a 60-minute cooldown.
- Breaker state is atomically persisted in
  `data/evolution-connection-control.json`, so backend restart does not clear it.
- Counters are cleared only after `open` remains stable for at least 2 minutes.
- A `connection.update` close with status reason `401` is classified as a
  logout, persisted for the 24-hour connection-doctor metric, and creates a
  deduplicated `evolution_session_logout_401` human-handoff item.
- A normal `close` without reason `401` is not reported as a logout.

## Independent alarms

SMTP is the independent alarm channel for the first `401`, repeated `428`, an
opened breaker, and recovery after a stable `open`. Configure
`SMTP_ALERT_ENABLED`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USERNAME`,
`SMTP_PASSWORD`, `SMTP_FROM`, and `SMTP_ALERT_RECIPIENTS`. Secrets and recipient
addresses are never included in logs. Dashboard handoff records remain an audit
surface, but they are not treated as a substitute for SMTP.

Owner manual connect/logout operations must use
`POST /dashboard/actions/evolution/connection-operation` with an owner token,
`confirm: true`, and `operation: "connect"` or `"logout"`. Direct calls to port
8080 bypass application controls and are break-glass root operations only.

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

The Invalid-buffer vendor patch and A/B egress testing remain P1 and are not
part of this control package.
