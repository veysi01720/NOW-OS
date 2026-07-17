# Package 06 - Golden Replay And Responses Quality Measurement

Status: COMPLETE WITH QUALITY GATE BLOCKED / PRODUCTION UNCHANGED

## Objective

Package 06 measures whether the Responses decision path can produce valid, grounded ConversationDecisionV3 objects across representative candidate and owner conversations. It does not switch the primary provider, send WhatsApp messages, apply state patches, publish knowledge, or modify production.

## Replay Boundary

```text
sanitized golden fixture
  -> provider-neutral Responses decision context
  -> ResponsesAdapter
  -> OpenAI Responses API strict V3 schema
  -> backend V3 validator
  -> deterministic semantic and safety checks
  -> sanitized metrics only
```

The replay has no sender, Evolution, outbound, state store, memory store, queue store, database, publish, vector, or Assistant binding dependency.

## Provider-Neutral Context

`buildResponsesDecisionContext` projects only the information needed for a decision:

- backend-owned role, channel, and mode
- actual latest user message from `backend_context.user_message.text`
- candidate state and missing fields
- sanitized conversation summary and recent messages
- approved applications
- knowledge source count and rule identifiers
- semantic decision context and canonical policy facts
- immutable runtime constraints

Transport identifiers, sender records, phone numbers, remote JIDs, message IDs, legacy provider prompts, and raw internal notes are not included. The previous V2 prompt string is never treated as the latest user message.

## Golden Catalog

The catalog contains 13 scenarios:

- greeting and candidate first contact
- compact age/gender/daily-hours intake
- work definition and clarification
- trust and unverified payment questions
- text-only preference and approved app routing
- unapproved app and prompt-injection adversarial cases
- owner trust guidance, candidate-facing rewrite, and owner text-only instruction

The catalog is sanitized and contains no production user, phone, JID, group, credential, or message identifier.

## Measurements

The harness records only:

- schema validity and backend validator rejection rate
- role boundary correctness
- required semantic evidence and forbidden-claim detection
- expected next action and state patch evidence
- model self-reported quality signals
- latency and token totals
- scenario pass/fail reason codes
- zero real outbound and no raw-output persistence

Replies and raw provider payloads are not printed or stored by the report.

## Ownership And Safety

| Concern | Owner |
| --- | --- |
| Fixture selection and expected evidence | Backend test harness |
| Role, state, allowed apps, and policy facts | Backend context |
| Strict structured generation | Responses API adapter |
| Schema and semantic acceptance | Backend validator and replay evaluator |
| State mutation and public outbound | Not available in Package 06 |
| Primary production response | Existing Assistant path |

## Known Contract Gap

ConversationDecisionV3 does not currently expose `preferred_work_mode` or `video_allowed` in `state_patch`. Package 06 can measure text-only reply and approved-app behavior, but it cannot certify persistence of that preference through V3. This is a recorded follow-up for the morning cross-package review and is not expanded inside this package.

## Rollback

Package 06 does not deploy or enable a runtime path. Removing the candidate image and staging workspace is sufficient; production requires no rollback. The current Assistant remains the canonical response and rollback path.

## Explicit Non-Goals

- No Responses primary cutover or production canary.
- No Assistant ID, provider, or production model change.
- No WhatsApp or Evolution request.
- No production webhook, database, queue, state, memory, knowledge, or vector mutation.
- No repair loop or automatic prompt tuning.
- No expansion of the V3 state contract.
