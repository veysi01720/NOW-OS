# R1 Responses Adapter Design V1

Status: SHADOW-WIRED / PRIMARY RUNTIME UNSELECTED

`ResponsesAdapter` is shadow-wired behind an explicit default-off observer. The runtime factory continues to select `AssistantAdapter`; no primary provider switch, Assistant binding change, vector change, or publish action is introduced by this status update.

## Boundary

Both provider adapters implement the same canonical boundary:

```text
ModelExecutionService
  -> IModelAdapter.run(ModelAdapterInput)
  -> ModelAdapterOutput
```

`AssistantAdapter` is the only factory-selected runtime implementation. `ResponsesAdapter` remains unavailable to the public response path and may run only through the separately gated shadow observer. Shadow results cannot modify the canonical reply, state, memory, queue, or outbound delivery.

## Contract Decision

The canonical method is `run`, using `ModelAdapterInput` and `ModelAdapterOutput`. This preserves current conversation identifiers, backend context, lifecycle hints, provider-neutral traces, and the existing Assistant path.

Breaking changes required: NO.

The earlier source-ahead `execute(ModelExecutionRequest)` shape was not used by the runtime and conflicted with the actual service call. Package 04 removes that duplicate contract instead of forcing the live Assistant behavior into an unproven request model.

## Responses Mapping

The shadow-only adapter maps:

| Canonical input | Responses input |
| --- | --- |
| `normalizedUserMessage` | latest user text |
| `contextPayload` | backend-owned context block |
| `metadata.traceId` | sanitized trace reference |
| `execution.timeoutMs` | provider timeout hint |

It requests the Conversation Decision V3 strict JSON schema. It does not own state, memory, routing, commands, persistence, outbound delivery, or knowledge publishing.

## Authority And Safety

- Backend state and validators remain authoritative.
- Owner/manager commands and group boundaries remain deterministic backend concerns.
- Raw provider responses are not stored by the adapter contract.
- Raw phone numbers, JIDs, group IDs, prompts, API keys, and secrets must not enter adapter traces.
- Invalid structured decisions remain unnormalized and must fail closed in the backend validator.
- `internal_boss_note` remains non-public on the active Assistant contract.

## Runtime Selection Gate

Primary production selection of `ResponsesAdapter` still requires a separate approved cutover package covering:

- explicit provider selection semantics,
- strict decision validation and repair behavior,
- isolated replay and no-outbound acceptance,
- shadow/canary controls,
- rollback criteria,
- runtime provenance and exact-image verification.

Package 05 satisfies the shadow controls, isolated validation, no-outbound acceptance, rollback flag, and observability prerequisites. Until a later cutover approval, the primary factory must not import or return `ResponsesAdapter`; only the shadow observer may reach the adapter, and runtime code outside the adapter must not invoke `responses.create`.
