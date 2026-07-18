# Package 13 Path B Intent Scope Proof Report

Date: 2026-07-18

## Result

```text
INTENT_SCOPE_WATERTIGHT=NO
PATH_B_STATUS=REJECTED
PATH_A_REQUIRED=YES
PACKAGE_12_GATE_RELAXED=NO
CANARY_ARMED=NO
OWNER_APPROVAL_CREATED=NO
DEPLOY_EXECUTED=NO
```

## Canonical V2 Branch

- `src/intelligence/conversation/ConversationContextBuilder.ts:12` returns one
  scalar intent or `null`.
- `src/intelligence/conversation/ConversationContextBuilder.ts:56` stores that
  value at `latest_message.inferred_intent`.
- `src/intelligence/conversation/ConversationDecisionEngine.ts:163` copies the
  same scalar to adapter metadata.
- `src/modelAdapter/modelAdapterSelection.ts:97` uses exact array membership.
- `src/modelAdapter/responsesGoldenReplay.ts:291` labels the unknown-app
  qualification scenario `app_fact_question`.

The production classifier produces:

| Message class | Inferred intent | Configured gate result |
| --- | --- | --- |
| Greeting | `greeting_or_first_contact` | eligible by intent |
| Candidate first contact | `candidate_first_contact` | eligible by intent |
| Unknown app | `null` | `denied_intent` |
| Unknown-app qualification label | `app_fact_question` | `denied_intent` |

Targeted proof command:

```text
npm.cmd test -- --run src/tests/modelAdapter/package13CandidateCanary.test.ts
Test Files 1 passed (1)
Tests 4 passed (4)
```

## Runtime Scope Gap

- `src/bridge/handleIncomingMessage.ts:917` and the retry callsite at line 957
  omit `model_adapter_canary_intents`, `model_adapter_canary_percent`, and
  `inferredIntent` on the legacy model-execution path.
- `src/modelAdapter/modelAdapterSelection.ts:86` enters intent/channel/traffic
  enforcement only when the intent list is non-empty.
- `src/modelAdapter/modelAdapterSelection.ts:129` can then select by tenant and
  role alone.
- `src/modelAdapter/modelAdapterCanaryControl.ts:80` validates approval, stop
  latch, idempotency, and budget, but not event intent.

This is a fail-open scope condition under an alternate route/configuration.
Consequently `p12_unknown_app_missing_info` cannot be formally marked irrelevant
to the current canary arm.

## Verification

```text
npm.cmd run build
WORKSPACE_PREFLIGHT=PASS
TypeScript build exit=0

npm.cmd test -- --run --reporter=json
Test suites: 174/174 passed
Tests: 546/546 passed
Failed: 0
```

The full suite remains green because this task added proof for the correctly
configured V2 branch and documentation; it did not change runtime selection.

## Decision

No approval, deploy, flag change, shadow, or canary arm was performed. The next
work must follow Path A: close the missing-policy blocker and/or make model
adapter canary selection fail closed for absent intent-scope metadata, then run
the combined qualification gate again.
