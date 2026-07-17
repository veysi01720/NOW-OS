# Package 04 - Canonical Model Adapter Contract

Status: ACCEPTED CANDIDATE / NOT DEPLOYED / PRODUCTION UNCHANGED

## Decision

The canonical provider-neutral interface is:

```ts
interface IModelAdapter {
  readonly name: string;
  readonly provider: string;
  run(input: ModelAdapterInput): Promise<ModelAdapterOutput>;
  health(): Promise<ModelAdapterHealth>;
  getIdentity(): ModelAdapterIdentity;
}
```

This is the contract already consumed by `ModelExecutionService` and preserves the current thread mapping, backend context, response parsing, timeout/cancellation wrapper, and provider identity diagnostics.

## Resolved Findings

- P2-F01: removed the incompatible `execute`-only interface and its duplicate request/result family.
- P2-F02: removed the direct Assistant execution branch from `ModelExecutionService`; both flag-on and flag-off execution now enter through `IModelAdapter.run`.
- Removed `@ts-nocheck` from `AssistantAdapter`, `modelAdapterFactory`, `modelExecutionService`, and the adapter contract suite.
- Added adapter identity to `AssistantAdapter` without exposing an Assistant identifier.
- Aligned the source-only `ResponsesAdapter` with the same `run/health/getIdentity` interface.

## Compatibility

Flag-off behavior remains externally compatible:

- the factory still selects `AssistantAdapter`;
- the same Assistant client and thread store are used;
- raw Assistant output is unchanged;
- `normalizedResponse` remains null at the legacy boundary;
- provider trace retains `legacy_assistant_boundary`;
- provider, model, Assistant binding, webhook, queues, and outbound behavior are unchanged.

Flag-on behavior retains normalized Assistant Response Contract v1.0 output and contract-failure telemetry.

## Responses Status

`ResponsesAdapter` remains source-only and runtime-unselected. Package 04 repairs its interface fit but does not activate it, add a provider switch, publish knowledge, modify a vector store, or call the real Responses API.

## Rollback

Rollback is source/image based. The Package 03 immutable candidate and the pre-Package-04 source archive remain available. No database migration or runtime flag migration is required.
