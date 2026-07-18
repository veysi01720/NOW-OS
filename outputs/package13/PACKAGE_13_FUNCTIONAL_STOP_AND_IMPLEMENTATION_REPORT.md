# Package 13 Functional Stop and Candidate Canary Implementation Report

Date: 2026-07-18  
Status: IMPLEMENTED / LOCAL PASS / NOT ARMED

## Automatic Stop Runtime Proof

Implementation files:

- `src/modelAdapter/modelAdapterCanaryThresholds.ts`
- `src/modelAdapter/modelAdapterCanaryApproval.ts`
- `src/modelAdapter/modelAdapterCanaryControl.ts`
- `src/modelAdapter/modelExecutionService.ts`
- `src/bridge/handleIncomingMessage.ts`
- `src/server.ts`

The immediate `unsafe_claim_count >= 1` event is evaluated after the canonical
Conversation Decision path and before state mutation or `sendReply`. The
controller atomically invalidates the file-backed approval, latches effective
canary mode to `off`, denies new reservations, preserves the terminal count,
and restores the latch from the invalidation reason after controller restart.

Sanitized events asserted by the runtime test:

```text
MODEL_ADAPTER_CANARY_AUTOMATIC_STOP
threshold_ids=unsafe_claim_count
effective_canary_mode=off
approval_invalidated=true
egress_allowed=false
raw_text_logged=false

MODEL_ADAPTER_CANARY_EGRESS_BLOCKED
threshold_ids=unsafe_claim_count
effective_canary_mode=off
outbound_count=0
raw_text_logged=false
```

Evidence command and result:

```text
npm.cmd test -- --run --reporter=verbose src/tests/modelAdapter/modelAdapterCanaryRuntimeStop.test.ts src/tests/modelAdapter/package13CandidateCanary.test.ts
Test Files  2 passed (2)
Tests       5 passed (5)
```

The canonical no-outbound test uses the production
`handleIncomingMessage -> executeConversationDecisionV2 -> ModelExecutionService
-> terminal evaluator -> outbound gate` functions. `FakeSender.sends` remains
zero for the unsafe event. No Evolution API or real WhatsApp sender is used.

## Package 13 Scope

Implemented:

- `MODEL_ADAPTER_CANARY_INTENTS`, default empty;
- `MODEL_ADAPTER_CANARY_PERCENT`, default zero;
- SHA-256 stable traffic bucket;
- private candidate + canonical tenant + exact first-contact intent scope;
- approval and message-budget reservation;
- Responses adapter primary selection only for the scoped canary;
- strict V3 shape and semantic validation before the existing transition and
  egress boundary;
- same-provider single repair reservation reuse;
- no hidden Responses-to-Assistants per-request fallback;
- sanitized Connection Doctor stop and approval counters.

Tests explicitly exclude owner, group, wrong tenant, payment/non-greeting
intent, and traffic outside the selected bucket.

## Verification

```text
npm.cmd run build
BUILD=PASS

npx.cmd vitest run --reporter=json
TEST_FILES_TOTAL=170
TEST_FILES_PASSED=170
TESTS_TOTAL=539
TESTS_PASSED=539
TESTS_FAILED=0

CHANGED_FILES_SECRET_PII_SCAN=PASS
REAL_EVOLUTION_SEND_COUNT=0
REAL_WHATSAPP_OUTBOUND_COUNT=0
```

The real Package 12 provider qualification was not rerun because this local
runtime has neither `OPENAI_API_KEY` nor `OPENAI_RESPONSES_MODEL` available.
No prompt, strict schema, semantic qualification rule, or golden scenario was
changed. The previously accepted Package 12 qualification remains the
model-quality evidence; this report does not fabricate a new provider run.

## Runtime State

```text
MODEL_ADAPTER_LAYER_ENABLED=false
MODEL_ADAPTER_CANARY_MODE=off
MODEL_ADAPTER_CANARY_INTENTS=<empty by default>
MODEL_ADAPTER_CANARY_PERCENT=0
RESPONSES_SHADOW_ENABLED=false
CANARY_ARMED=NO
OWNER_APPROVAL_CREATED=NO
DEPLOY_EXECUTED=NO

AUTOMATIC_STOP_CODE_ACTIVE=YES
FUNCTIONAL_CANARY_ARM_READY=YES
PACKAGE_13_IMPLEMENTATION_STATUS=LOCAL_PASS_NOT_ARMED
```
