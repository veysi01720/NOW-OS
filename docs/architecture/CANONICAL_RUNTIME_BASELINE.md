# Canonical Runtime Baseline

## Document Control

- Package: `PACKAGE-01 Canonical Runtime Audit`
- Evidence window: `2026-07-14T20:57Z - 2026-07-14T21:06Z`
- Evidence type: read-only source, container, Compose, database, health and sanitized log inspection
- Production mutation: `NO`
- Secret or raw PII recorded: `NO`
- Baseline status: `VERIFIED_WITH_TRACKED_FINDINGS`

This document is the source of truth for the runtime that was actually serving
the production backend during the evidence window. Previous agent reports,
local workspaces and source-only changes are not runtime proof.

## Canonical Production Identity

| Field | Verified value |
| --- | --- |
| VPS hostname | `ubuntu-8gb-hel1-1` |
| Source root | `/root/deploy_package/now_os_backend` |
| Compose project | `deploy_package` |
| Compose service | `now_os_backend` |
| Container | `now_os_backend` |
| Package | `now-os-minimal-fastify-bridge` |
| Working directory | `/app` |
| Command | `node dist/server.js` |
| Public application port | VPS loopback `3000` |
| Webhook route | `/webhooks/evolution` |
| Runtime role | `production_whatsapp_backend` |
| Workspace id | `now_os_backend` |
| Runtime outbound callsite id | `sendTextMessage.evolution.v1` |

The container was running and healthy. Both `/healthz` and `/readyz` returned
HTTP `200` during the audit.

## Running Image Evidence

- Container id: `1ecbc9ea362f0d2f8d4cc8601b26adb5ab7c5bd334e4cb483d708b0054d9cf64`
- Running image id: `sha256:a2c15c844f3d9e007c1c4f61ce82324656de6398b973f10b742265e822a93424`
- Image creation time: `2026-07-13T15:35:29Z`
- Container start time: `2026-07-13T15:35:31Z`

The following host source artifacts matched their counterparts in the running
container byte-for-byte:

| Artifact | SHA-256 |
| --- | --- |
| `dist/server.js` | `d149a5d5aac0d4f56b7ea199ed94805c8889b8a76ea432ae9f88798677fa545d` |
| `workspace.identity.json` | `4db557418dcaad79bf29c01788f72ca2a36aee0aa18d338f4f8054de3b35c57b` |
| `package.json` | `03a40a7661788e8c9e100597b5a61c65b90a2715cbe12277a5b3ccc7b5575e93` |

The deployed source set contained `184` files under `src`. All corresponding
files matched the canonical host source except for the explicitly recorded
source-ahead delta below.

## Source Ahead Of Running Image

The canonical source root contains work that was created after the running
image and is not present in that image.

Host-only source files:

- `src/intelligence/conversation/ConversationDecisionV3Schema.ts`
- `src/modelAdapter/ResponsesAdapter.ts`
- `src/tests/conversationDecisionV3Schema.test.ts`
- `src/tests/goldenBadWhatsappCases.test.ts`
- `src/tests/modelAdapter/responsesAdapter.contract.test.ts`
- `src/tests/fixtures/golden-bad-whatsapp-cases.json`

Changed host file:

- `src/tests/architecture/architectureSeal.test.ts`

The corresponding built V3 and Responses files exist in the host `dist`
directory but do not exist in the running container. These files are planned
migration work, not active production behavior and not legacy cleanup targets.

## Build Provenance State

- The canonical source root is not a Git working tree.
- The running image label reports the source tree hash as `unknown`.
- The running image label reports the package-lock hash as `unknown`.
- Build identity values embedded in the environment are not authoritative for
  the currently running image.
- The stored build manifest refers to an older image and is not a current
  deployment certificate.

Until provenance hardening is completed, the Docker image id plus explicit
file hashes in this document are the authoritative deployment evidence.

## Canonical Evolution Baseline

| Field | Verified state |
| --- | --- |
| Container | `nowakademi_evolution` |
| Instance | `nowakademi_bot` |
| Instance state | `open` |
| Webhook enabled | `YES` |
| Webhook target | `http://now_os_backend:3000/webhooks/evolution` |
| `MESSAGES_UPSERT` enabled | `YES` |
| Backend URL class | Compose-internal Evolution endpoint |
| Backend and gateway network | `deploy_package_default` |

The database also contains a closed legacy instance named `Now_Akademi`. It is
not the canonical instance and had no active canonical webhook row in this
audit.

## Active Runtime Flags

| Capability | Runtime state |
| --- | --- |
| Behavior Orchestrator | `OFF` |
| Behavior canary | `OFF` |
| Tenant canary | `OFF` |
| Model adapter layer | `OFF` by default |
| Model adapter canary | `OFF` by default |
| Conversation Decision V2 | `ON` by default |
| Inbound queue mode | `OFF` |
| Outbound queue mode | `OFF` |
| Workers | `OFF` |
| Fast ACK | `OFF` |
| Ownership probe | `OFF` |

The Connection Doctor reported gateway reachability as healthy but inbound
receiving as degraded because no recent inbound had been confirmed. This is a
live-canary blocker, not evidence of a source or send-path ownership change.

## Active Decision Paths

### Candidate private messages

```text
Evolution webhook
-> normalizeEvolutionMessage
-> role resolution and candidate state machine
-> Conversation Decision V2
-> ModelExecutionService legacy boundary
-> OpenAI Assistants thread/run
-> V2 parse and validation
-> semantic quality and state patch validation
-> sendReply
-> EvolutionApiSender.sendText
```

### Owner and manager general messages

```text
Evolution webhook
-> deterministic command checks
-> backend context
-> ModelExecutionService legacy boundary
-> OpenAI Assistants thread/run
-> Assistant Response Contract V1 parser
-> behavior quality and approved-app guards
-> sendReply
-> EvolutionApiSender.sendText
```

### Group messages

- Prefixless group messages are safe-ignored.
- Unauthorized group commands are rejected before model execution.
- Authorized deterministic commands run before any general model path.

Responses API is not part of any active runtime path in this baseline.

## Active Outbound Ownership

The active production send path is:

```text
handleIncomingMessage.sendReply
-> EvolutionApiSender.sendText
-> /message/sendText/nowakademi_bot
```

The queue worker references the same `EvolutionSender` abstraction, but workers
and queue-only modes are disabled. No active VPS bridge service, n8n service or
port `8200`/`5678` sender was found.

Sanitized runtime logs from the evidence window confirmed:

- `9` webhooks received
- `5` Conversation Decision V2 traces
- `5` successful WhatsApp sends
- `4` model-origin V2 decisions
- `1` deterministic safety response after final validation

## Local Runtime Inventory

The PC still runs non-canonical services:

- local `now_os_backend`
- legacy assistant API
- legacy Assistants V2 bridge
- RAG API
- n8n
- a stopped local Evolution container

The local backend targets the canonical instance name but its Evolution key does
not match production and its Evolution URL is a localhost fail-closed target.
It cannot currently use the canonical VPS Evolution path. It does share the
production OpenAI key and Assistant binding, which creates quota, confusion and
wrong-runtime execution risk.

No local service is canonical production evidence. Quarantine and deletion are
separate approved packages and are not performed by Package 1.

## Other Tracked Runtime Residue

The VPS has a stale Cloudflare container targeting localhost port `5678`, while
no VPS service is listening on that port. Dependency proof is required before
removal. It is not part of the canonical WhatsApp backend path.

## Baseline Rules

1. Only `/root/deploy_package/now_os_backend` may be described as canonical source.
2. Only the running VPS `now_os_backend` image may be described as production.
3. Source-only files are not deployed behavior.
4. A build result is not a deploy result.
5. A deploy result requires source manifest, image id and running-container proof.
6. Local containers must never be used as production acceptance evidence.
7. Evolution, PostgreSQL, session data and active state are outside cleanup scope.
8. Responses/V3 source work must be preserved until its migration package decides its fate.

