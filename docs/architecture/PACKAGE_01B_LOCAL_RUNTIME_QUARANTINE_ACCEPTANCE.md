# Package 01B - Local Runtime Quarantine Acceptance

## Package Result

- Package id: `PACKAGE-01B`
- Package name: `Local Runtime Quarantine`
- Status: `COMPLETE_WITH_PRESERVED_ROLLBACK`
- Scope: local PC only
- VPS backend changed: `NO`
- Evolution session or webhook changed: `NO`
- Container or volume deleted: `NO`
- Real WhatsApp outbound: `0`
- Secret or raw PII printed: `NO`

## Objective

Prevent non-canonical local runtimes from using production messaging or model
bindings while preserving their containers, volumes and rollback evidence for a
later controlled cleanup package.

## Audited Local Runtimes

| Runtime | Pre-quarantine state | Production access classification |
| --- | --- | --- |
| local `now_os_backend` | running | Evolution blocked, production OpenAI binding present |
| legacy assistant API | running | send disabled and Evolution dummy target |
| legacy Assistants V2 bridge | running | send disabled and Evolution dummy target |
| local n8n | running | stored-credential risk not inspected; treated as legacy message-capable runtime |
| local Evolution | stopped | session volume preserved |
| local RAG API | running | no Evolution or Assistant binding |
| local PostgreSQL and Redis | running | data services, outside quarantine stop scope |

Production Evolution key equality checks were performed without printing key
material. The active local messaging services did not carry the canonical VPS
Evolution key. The local backend and legacy bridge did share production OpenAI
binding material before their active containers were stopped.

## Configuration Changes

### Local `deploy_package` Compose

The local `now_os_backend` service now has:

- profile `local-quarantine-disabled`
- restart policy `no`
- runtime role `local_quarantined_backend`
- explicit fail-closed Evolution endpoint
- dummy Evolution key and dummy instance
- dummy OpenAI key and no Assistant binding
- Behavior, model adapter, queue, workers and Fast ACK disabled

Without explicitly selecting the quarantine profile, default Compose operations
do not include this service.

### Legacy `now-akademi-otomasyon` Compose

The following services now require profile `local-quarantine-disabled` and use
restart policy `no`:

- `n8n`
- `evolution-api`
- `assistant-api`
- `assistants-v2-bridge`

The assistant API and bridge additionally use:

- send disabled
- fail-closed local Evolution endpoint
- dummy Evolution key and dummy instance
- dummy OpenAI key
- no Assistant binding
- Behavior and canary disabled where applicable

The assistant API model execution flag is disabled.

## Runtime Actions

The following local containers were stopped without deletion:

- `now_os_backend`
- `now_akademi_assistant_api`
- `now_assistants_v2_bridge`
- `now_akademi_n8n`

The already stopped `now_akademi_evolution` container remained stopped. Restart
policy is `no` for all five containers.

The RAG API, PostgreSQL and Redis were not stopped because they have no
canonical WhatsApp outbound path and contain local development/data services.

## Verification

| Check | Result |
| --- | --- |
| Local backend Compose valid | `PASS` |
| Legacy Compose valid | `PASS` |
| Quarantined services excluded from default profile | `PASS` |
| Production instance selected in effective config | `NO` |
| Production Evolution URL selected in effective config | `NO` |
| Effective Evolution target fail-closed | `YES` |
| Effective Evolution credential dummy | `YES` |
| Effective OpenAI credential dummy | `YES` |
| Effective Assistant binding present | `NO` |
| Local backend stopped | `YES` |
| Legacy assistant API stopped | `YES` |
| Legacy bridge stopped | `YES` |
| Local n8n stopped | `YES` |
| Local Evolution stopped | `YES` |
| Ports 3000, 5678, 8100 and 8200 listening locally | `NO` |
| Container deleted | `NO` |
| Volume deleted | `NO` |
| Real send endpoint called | `NO` |

## Production Non-Impact Proof

- VPS image remained `sha256:a2c15c844f3d9e007c1c4f61ce82324656de6398b973f10b742265e822a93424`.
- VPS `now_os_backend` remained running and healthy.
- VPS container start time did not change.
- VPS `/healthz` returned `200`.
- VPS `/readyz` returned `200`.
- Production source, Compose, webhook, Evolution, PostgreSQL and state were not modified.

## Preserved Rollback Evidence

Original Compose files were copied before modification to:

`C:\Users\lll\Documents\Codex\2026-07-04\i\backups\local-runtime-quarantine_20260715_023151`

Original hashes:

- local deploy Compose: `db63b84ea5903e073d39914738be63f4bbe6234c37ca23d557a97d3bcc37fcbe`
- legacy Compose: `a61c118f50ec0edaae0aab9d6cf6d4a86023f7969fc58c6e73154ca1e055a1b6`

Rollback files do not need to be used for normal development. Restoring message
capability requires a separate owner-approved package and a fresh credential,
runtime identity and outbound audit.

## Residual Risks

1. Stopped containers retain their old environment snapshot in Docker metadata.
   It is inactive but remains until controlled container deletion or recreation.
2. The local n8n data volume may contain historical credentials. It is stopped
   and preserved for later dependency and cleanup review.
3. Multiple local source copies still exist. They remain a wrong-workspace risk
   until the later consolidation package.
4. The local RAG API and data services remain active for local-only use. They
   are not production acceptance evidence.

## Acceptance Decision

`PACKAGE_01B_STATUS=COMPLETE_WITH_PRESERVED_ROLLBACK`

Local messaging runtimes are inactive and excluded from default Compose startup.
Production messaging and model bindings are absent from their effective
quarantine configuration. Permanent deletion is intentionally deferred.

