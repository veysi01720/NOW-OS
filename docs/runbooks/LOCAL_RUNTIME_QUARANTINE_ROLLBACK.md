# Local Runtime Quarantine Rollback

## Purpose

This runbook records how Package 01B can be reversed without guessing. It is not
authorization to reactivate local WhatsApp or production model access.

## Protected State

Do not delete or reset:

- local PostgreSQL volume
- local n8n data volume
- local Evolution session volume
- stopped container metadata
- quarantine backup files
- VPS backend, Evolution or PostgreSQL

## Backup Location

`C:\Users\lll\Documents\Codex\2026-07-04\i\backups\local-runtime-quarantine_20260715_023151`

The directory contains the pre-quarantine Compose files for both local Compose
projects. No environment file was changed by Package 01B.

## Rollback Preconditions

Before any rollback:

1. Obtain explicit owner approval for the exact local service.
2. Confirm the service is not becoming a second production sender.
3. Confirm it will not target `nowakademi_bot` or the production Evolution URL.
4. Use local-only credentials and a dummy/local instance.
5. Keep send capability disabled unless a separate outbound test is approved.
6. Verify the VPS canonical runtime remains the only production owner.

## Controlled Restore Outline

1. Compare current Compose hashes with the Package 01B acceptance record.
2. Restore only the required service definition from the backup.
3. Keep restart policy `no` during validation.
4. Run `docker compose config` without printing resolved secret values.
5. Confirm runtime role is non-production.
6. Confirm production Evolution URL and instance are denied.
7. Start only the explicitly approved service.
8. Verify no real WhatsApp outbound occurred.

## Forbidden Rollback

- Do not restore every legacy service together.
- Do not start the local Evolution session as a production gateway.
- Do not copy production Evolution credentials to local files.
- Do not restore production OpenAI binding for convenience.
- Do not use a local service as production acceptance evidence.

