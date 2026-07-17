# Package 02 - Architecture Regression Specification

These checks are requirements for the first code-bearing package after the
ownership seal. They are specified here but are not introduced into production
by Package 02.

## Required Static Checks

1. Bridge and domain modules do not import the OpenAI SDK.
2. Provider adapters do not import state stores or Evolution sender modules.
3. `handleIncomingMessage` never sends raw provider output.
4. `internal_boss_note` is never an outbound source.
5. Only the canonical sender module contains the Evolution send endpoint.
6. Queue and synchronous send paths share idempotency and cannot both send.
7. Role resolution has one algorithm and no user-claim role elevation.
8. Active knowledge writes require an authorized backend workflow.
9. Source-only migration files are excluded from production capability claims.
10. Production model adapter files contain no `@ts-nocheck` after contract repair.

## Required Contract Checks

1. Assistant and Responses adapters implement the same interface.
2. Both return the same provider-neutral execution result shape.
3. Invalid structured output cannot reach state or outbound.
4. State patches require current-message or canonical-policy evidence.
5. Provider errors are sanitized and normalized.
6. Raw prompts, raw provider bodies and raw PII are not persisted.

## Required Flow Checks

1. Candidate V2 remains unchanged while Responses is flag-off.
2. Owner/manager V1 fallback remains unchanged while Responses is flag-off.
3. Group prefixless messages remain safe-ignored.
4. Unauthorized commands do not call a model.
5. One inbound event creates at most one public outbound.
6. Responses shadow mode creates zero real outbound.
7. Rollback to Assistants requires only a provider flag/binding decision, not a
   database or webhook rollback.

## Acceptance Evidence

- build and full tests pass in an isolated environment;
- adapter contract suite passes for both adapters;
- golden and adversarial replay passes;
- exact-image no-outbound acceptance passes;
- source/image provenance is verified;
- no production flag is enabled without separate owner approval.
