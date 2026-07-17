# Package 05 Acceptance Criteria

## Configuration And Routing

1. Shadow flags are absent or false by default.
2. Invalid shadow mode fails closed to `off`.
3. Missing model prevents shadow arming.
4. Groups, unlisted roles, and unlisted tenants are denied before provider execution.
5. Primary `modelAdapterFactory` still returns only `AssistantAdapter`.

## Execution

1. Eligible shadow calls `ResponsesAdapter` exactly once.
2. The provider request uses strict ConversationDecisionV3 JSON schema.
3. No unsupported `timeout_ms` field is added to the provider payload.
4. Valid schema, matching role, and non-empty reply produce `valid`.
5. Invalid JSON/schema, role mismatch, and empty reply produce `invalid`.
6. Provider and timeout failures produce sanitized terminal observations.
7. Shadow does not delay, replace, or throw through the canonical result.

## Side Effects And Security

1. Shadow has no outbound sender dependency and outbound count remains zero.
2. Shadow has no state, memory, queue, publish, or vector dependency and state-write count remains zero.
3. Sender, phone, remote JID, message, conversation, and trace identifiers are masked or hashed before the shadow provider call where applicable.
4. Telemetry contains no raw user text, response text, phone, JID, group ID, secret, API key, or provider error body.
5. Raw provider output is not persisted.

## Regression And Artifact Gates

1. Build passes.
2. Existing full test suite passes without skips or deleted tests.
3. Shadow unit, scope, invalid-output, timeout, no-state, and no-outbound tests pass.
4. Architecture seal confirms no primary factory selection and no parallel outbound pipeline.
5. Immutable image is built with source/dist/lock/workspace/manifest provenance.
6. Exact-image build and tests pass.
7. Isolated startup with shadow default-off reports healthy and ready.
8. Production image/container remains unchanged.
