# Package 05 - Responses API Shadow Integration

Status: PASS / IMMUTABLE CANDIDATE READY / PRODUCTION NOT DEPLOYED

## Objective

Package 05 introduces a measurable Responses API decision path without allowing it to own or alter a public reply. The current Assistant path remains canonical. The shadow path receives a provider-neutral model input, produces a ConversationDecisionV3 candidate, validates it, and records sanitized comparison telemetry.

## Canonical Flow

```text
normalized inbound
  -> backend role/state/context
  -> ModelExecutionService
  -> AssistantAdapter (canonical result)
  -> existing validator/outbound path

ModelExecutionService canonical success
  -> ResponsesShadowService.observe (non-blocking)
  -> ResponsesAdapter
  -> OpenAI Responses API strict V3 schema
  -> backend V3 shape/role/reply validation
  -> sanitized observation only
```

The shadow branch has no sender, state store, memory store, queue store, or publishing dependency.

## Configuration

All shadow configuration is default-off:

- `RESPONSES_SHADOW_ENABLED=false`
- `RESPONSES_SHADOW_MODE=off`
- `RESPONSES_SHADOW_TENANTS` empty
- `RESPONSES_SHADOW_ROLES` empty
- `RESPONSES_SHADOW_TIMEOUT_MS=15000`
- `OPENAI_RESPONSES_MODEL` unset

An enabled flag with mode `off` or no configured model does not create or invoke the Responses adapter. `internal` requires an explicit role. `tenant_allowlist` requires both an explicit role and tenant. Group messages are always denied.

## Ownership Boundaries

| Concern | Owner |
| --- | --- |
| Canonical public reply | Existing Assistant path |
| Role and authorization | Backend |
| State/memory/queue mutation | Backend canonical path |
| Responses provider call | `ResponsesAdapter` |
| Shadow eligibility and timeout | `ResponsesShadowService` |
| V3 shape and role validation | Backend shadow observer |
| WhatsApp send | Existing canonical outbound only |

## Security

Before provider execution, conversation, trace, message, sender, phone, and remote-JID identifiers are replaced or hashed. User text and semantic backend context remain model inputs but are never emitted into telemetry. Observation logs contain only status, reason code, schema/role/reply booleans, latency, adapter identity, hashes, and zero side-effect counters.

Raw provider responses are not persisted. Provider error details are reduced to `provider_failure`; timeout becomes `deadline_exceeded`.

## Failure Isolation

- Shadow runs after canonical model success and is not awaited by the canonical response.
- Synchronous observer errors are swallowed at the observer boundary.
- Asynchronous provider, timeout, parse, schema, role, and empty-reply failures become observations only.
- A late provider result cannot update state or outbound because the shadow service owns neither.
- Rollback is configuration-only: set `RESPONSES_SHADOW_ENABLED=false` and `RESPONSES_SHADOW_MODE=off`.

## Explicit Non-Goals

- No primary provider switch.
- No Assistant ID or model change.
- No state patch application from V3.
- No repair call.
- No WhatsApp output from Responses.
- No knowledge publish or vector mutation.
- No queue/worker or Fast ACK cutover.
- No production deployment in this package.
