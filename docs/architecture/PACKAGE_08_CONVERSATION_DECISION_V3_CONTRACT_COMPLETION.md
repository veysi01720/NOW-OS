# Package 08 - ConversationDecision V3 Contract Completion

Status: IMPLEMENTED / VERIFICATION PENDING / PRODUCTION UNCHANGED

## Objective

Package 08 completes the source-only Responses decision contract before backend semantic enforcement. It makes action namespaces explicit, adds text-only preference fields, and requires structured evidence metadata for proposed state changes.

The contract version becomes `3.1`. The TypeScript module name remains `ConversationDecisionV3Schema` because this is the additive V3 migration family, not a new production decision engine.

## Action Namespaces

V3.1 separates two concepts that must not be compared as identical strings:

1. `chosen_actions` contains backend domain action IDs. Every value must be one of the V3 action catalog and, in Package 09, must also be a subset of backend-context `allowed_actions`.
2. `next_action` contains an orchestration outcome such as `ask_missing_info`, `answer_direct_question`, or `update_candidate_state`.

`next_action` compatibility with `chosen_actions` is a semantic validation concern. Package 08 defines the types; Package 09 enforces the compatibility matrix.

## State Patch Completion

V3.1 state patches include:

- age
- gender
- daily_hours
- work_model_acceptance
- selected_app
- phone_type
- work_model_disclosed
- preferred_work_mode
- video_allowed

`preferred_work_mode` is `text_only`, `video_or_voice_allowed`, or null. `video_allowed` is boolean or null. Null means no proposed change.

## State Patch Evidence

Every decision contains `state_patch_evidence`, an array of structured evidence records:

- `field`: one state-patch field name
- `source`: `current_message`, `existing_state`, `canonical_policy_fact`, or `reply_content`
- `evidence_ref`: a sanitized policy fact ID when applicable, otherwise null

Raw user text is not an evidence reference. Package 09 will reject non-null patches without compatible evidence and duplicate or contradictory evidence records.

## Strict Schema

- Decision version: `3.1`.
- Every object uses `additionalProperties: false`.
- All strict-output properties are required.
- `chosen_actions`, state fields, evidence fields, and evidence sources use enums.
- Empty `state_patch_evidence` is valid when every proposed patch field is null.

## Compatibility

- Production Conversation Decision V2 is unchanged.
- Assistant Response Contract V1.0 is unchanged.
- Responses remains shadow-only, default-off, and primary-runtime unselected.
- Existing production state is not migrated.
- No V3 patch is applied to production state in this package.

## Explicit Non-Goals

- No action allowlist enforcement; Package 09 owns it.
- No state-evidence semantic enforcement; Package 09 owns it.
- No final egress app-name guard; Package 09 owns it.
- No Responses model benchmark, canary, deployment, or cutover.
- No provider, model, Assistant binding, Evolution, webhook, database, queue, knowledge, or vector change.
