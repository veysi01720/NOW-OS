# Model Adapter Canary Runbook

## Purpose

The model adapter layer lets the runtime call the current Assistant execution through a provider-neutral boundary before any future provider migration. It does not change the model provider, Assistant binding, response contract, knowledge sources, vector store, webhook target, or queue cutover mode.

## Defaults

Production-safe defaults:

```env
MODEL_ADAPTER_LAYER_ENABLED=false
MODEL_ADAPTER_CANARY_MODE=off
MODEL_ADAPTER_CANARY_TENANTS=
MODEL_ADAPTER_CANARY_ROLES=owner,manager
```

`MODEL_ADAPTER_LAYER_ENABLED=true` is a global adapter enable switch. Keep it off unless a separate production approval explicitly allows global cutover.

## Canary Modes

`MODEL_ADAPTER_CANARY_MODE=off`

Adapter canary is disabled. Runtime uses the legacy-equivalent Assistant execution path inside the model boundary.

`MODEL_ADAPTER_CANARY_MODE=internal`

Only roles listed in `MODEL_ADAPTER_CANARY_ROLES` can use the adapter path. The default is `owner,manager`. Normal users remain on the legacy-equivalent boundary path.

`MODEL_ADAPTER_CANARY_MODE=tenant_allowlist`

The tenant must be present in `MODEL_ADAPTER_CANARY_TENANTS`, and the sender role must be present in `MODEL_ADAPTER_CANARY_ROLES`. Empty tenant allowlist means denied.

## Diagnostics

Use `/healthz/connection-doctor` and inspect the sanitized `model_adapter` section:

- `model_adapter_layer_global_enabled`
- `model_adapter_canary_mode`
- `model_adapter_canary_scope_supported`
- `model_adapter_current_decision`
- `model_adapter_selected_adapter`
- `model_adapter_provider`
- `model_adapter_last_success_at`
- `model_adapter_last_error_class`
- `model_adapter_rollback_method`
- `assistant_id_changed`
- `provider_changed`
- `responses_api_used`

Diagnostics must not include raw prompts, raw message text, raw phone numbers, raw JIDs, group IDs, API keys, secrets, or raw provider responses.

## Rollback

Rollback method: `FLAG_OFF`.

1. Set `MODEL_ADAPTER_LAYER_ENABLED=false`.
2. Set `MODEL_ADAPTER_CANARY_MODE=off`.
3. Restart the runtime.
4. Confirm `/healthz/connection-doctor` shows adapter decision disabled.
5. Confirm normal message processing remains on the legacy-equivalent boundary path.

No database reset, webhook target change, vector publish, Assistant binding change, queue cutover, or provider migration is part of adapter canary rollback.

## Behavior Flag Difference

`BEHAVIOR_ORCHESTRATOR_ENABLED` controls behavior context and response planning.

`MODEL_ADAPTER_LAYER_ENABLED` and `MODEL_ADAPTER_CANARY_MODE` control the model execution boundary only.

These flags are independent. Enabling behavior context does not enable adapter execution, and enabling adapter canary does not enable behavior orchestration.

## Queue Flag Difference

Queue and fast ACK flags control webhook and outbound reliability paths:

- `WEBHOOK_QUEUE_MODE`
- `OUTBOUND_QUEUE_MODE`
- `FAST_ACK_ENABLED`
- `WORKERS_ENABLED`

Adapter canary does not enable fast ACK, queue-only mode, or production workers.

## Before Any Future Responses Adapter

Required before implementing a Responses adapter:

- Current AssistantAdapter parity remains green.
- Bridge has no direct Assistant execution dependency.
- Contract v1.0 tests pass.
- Adapter canary diagnostics are available.
- Raw output is never user-facing.
- Rollback by flag-off is verified.
- Owner approval exists for any new provider/API migration.

## Synthetic / Replay Canary Seal

Owner live WhatsApp canary is optional for adapter design work. If owner or manager live messages will not be used, run the synthetic/replay canary harness instead.

The replay harness must verify:

- Sanitized normalized inbound replay.
- Owner and manager internal scope can select the AssistantAdapter path.
- Normal user scope is denied by default.
- Empty tenant allowlist is denied.
- Group safe-ignore and unauthorized group command paths do not call the model.
- Contract v1.0 parsing is preserved.
- Only public `reply` would be sent through the outbound spy.
- `internal_boss_note` and raw model output are not user-facing.
- Provider, Assistant binding, and Responses API status remain unchanged.

Synthetic/replay canary is enough to unblock Responses adapter design. It is not enough by itself to enable adapter global default-on or production rollout.

Adapter default-on requires either:

1. A live observation window with explicit owner approval, or
2. A separate explicit owner approval that accepts synthetic/replay evidence as sufficient for the rollout risk.

Responses adapter implementation is a separate task and requires explicit approval. Do not implement a Responses adapter from this runbook alone.

## Never Do In This Runbook

- Do not change provider.
- Do not change Assistant binding.
- Do not migrate directly to Responses API.
- Do not send raw model output to users.
- Do not log raw prompts, raw text, raw phone numbers, raw JIDs, group IDs, API keys, or secrets.
- Do not reset the database.
- Do not change webhook target.
- Do not trigger OpenAI publish or vector store changes.
