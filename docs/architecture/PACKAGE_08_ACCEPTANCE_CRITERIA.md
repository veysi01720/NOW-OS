# Package 08 Acceptance Criteria

## Contract

1. ConversationDecision V3 schema version is `3.1`.
2. `chosen_actions` accepts only the declared backend domain action catalog.
3. `next_action` remains a separate orchestration enum.
4. `preferred_work_mode` and `video_allowed` are required nullable state-patch fields.
5. `state_patch_evidence` is required and contains only declared fields, sources, and sanitized references.
6. Every schema object has `additionalProperties: false`.

## Fixtures And Adapter

1. Responses adapter sends the V3.1 strict schema with `store=false`.
2. Golden fixtures use backend action IDs rather than orchestration IDs in `chosen_actions`.
3. Golden evaluator checks expected `next_action` separately from the chosen-action allowlist.
4. Text-only candidate fixtures expect `preferred_work_mode=text_only` and `video_allowed=false`.
5. Non-null fixture patches carry corresponding evidence records.

## Compatibility And Safety

1. Conversation Decision V2 and Assistant Response Contract V1.0 remain unchanged.
2. Responses remains default-off and absent from the primary adapter factory.
3. No production state migration or write occurs.
4. Build, full tests, provenance, exact-image tests, and isolated startup pass.
5. Real OpenAI and WhatsApp outbound counts remain zero.
6. Production image, Evolution, webhook, database, knowledge, vector, provider, model, and Assistant binding remain unchanged.

## Package Decision

Package 08 completion authorizes Package 09 backend semantic enforcement only. It does not authorize Responses deployment, model benchmark, canary, or production cutover.
