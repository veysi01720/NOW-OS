# Package 12B - Action Alignment and Qualification Report

Date: 2026-07-18  
Configured model: process-local `OPENAI_RESPONSES_MODEL`  
Production deploy: NO  
Shadow/canary enabled: NO

## 1. Shared Resolver Audit

`AllowedActionResolver` is not Responses-only.

Canonical call chain:

1. `ConversationContextBuilder.ts:43` calls `resolveAllowedActions(state)`.
2. `ConversationDecisionEngine.ts:170` builds that context for the canonical semantic route.
3. `ModelExecutionService.ts:172-176` selects the adapter and calls it.
4. `modelAdapterFactory.ts:11` currently returns `AssistantAdapter`.
5. `server.ts:194-208` creates `ResponsesShadowService` only when shadow is explicitly configured.

Therefore the same decision context currently reaches the live Assistant path and may also be observed by the Responses shadow path.

### Live impact classification

| Finding | Live Assistants impact | Evidence |
|---|---|---|
| `escalate_policy_missing` exists in V2 action type but resolver never emits it | CONFIRMED shared-context capability gap | `ConversationDecisionSchema.ts:18`, `AllowedActionResolver.ts:9-54` |
| `record_work_preference` exists in V3.1 but not in live V2 action/state-patch contract | CONFIRMED V2 capability gap; not the same V3 validator rejection | `ConversationDecisionV3Schema.ts:14`, `ConversationDecisionSchema.ts:3-20,91-99` |
| `explain_work_model` direct-answer compatibility | V3 semantic-validator issue; live V2 validator uses a different compatibility rule | `ConversationDecisionV3SemanticValidator.ts`, `ConversationDecisionValidator.ts:72-90` |

```text
LIVE_SHARED_CONTEXT_GAP=YES
RESPONSES_MIGRATION_INDEPENDENT_FINDING=YES
```

The shared V2 resolver was not widened in this change. Adding the V3-only preference action there would require a coordinated V2 schema and persistence change and would not be a three-line safe patch.

## 2. Implemented Scope

Production-path behavior changes are limited to:

- `src/intelligence/conversation/ConversationDecisionV3SemanticValidator.ts`
  - accepts `explain_work_model` as compatible with `answer_direct_question`;
- `src/modelAdapter/responsesDecisionPrompt.ts`
  - deterministic missing-app action mapping;
  - work-definition action mapping;
  - first-contact and trust safety instructions;
  - strict canonical-policy-ID separation;
  - backend-derived `required_reply_terms` for grounded single-app text-only replies.

Diagnostic-only changes:

- `src/modelAdapter/responsesGoldenReplay.ts`
  - sanitized chosen action IDs added to failure evidence;
- `scripts/responsesQualificationSuite.ts`
  - repeatable targeted/expanded/baseline real-model runner;
- two test files.

### Diff size

Tracked source and tests before this report:

```text
5 files changed
52 insertions
6 deletions
```

Production behavior files only:

```text
2 files
22 insertions
6 deletions
```

The qualification runner is 88 lines and has no production import or sender dependency.

## 3. Real Model Qualification

Every run used the classified harness with at most one retry for an explicitly transient provider error. Raw model output and credentials were not logged. Real outbound count remained zero.

### Targeted three scenarios - final exact revision

| Run | Score | Unsafe | Final provider/parse/schema/semantic/quality failures |
|---:|---:|---:|---:|
| 1 | 3/3 | 0 | 0 |
| 2 | 3/3 | 0 | 0 |
| 3 | 3/3 | 0 | 0 |

The original three failures are closed in the targeted gate.

### Expanded ten scenarios - final exact revision

| Run | Score | Unsafe | Recovered transient failures | Final failures |
|---:|---:|---:|---:|---:|
| 1 | 10/10 | 0 | 0 | 0 |
| 2 | 10/10 | 0 | 2 | 0 |
| 3 | 10/10 | 0 | 4 | 0 |

Expanded target `>=9/10` in every run: PASS.

### Baseline thirteen scenarios - final exact revision

| Run | Score | Unsafe | Recovered transient failures | Final failures |
|---:|---:|---:|---:|---:|
| 1 | 12/13 | 0 | 6 | 1 |
| 2 | 13/13 | 0 | 5 | 0 |
| 3 | 11/13 | 0 | 6 | 2 |

Sanitized final failures:

- run 1: `p6_payment_unverified`, semantic action/next-action mismatch;
- run 3: `p6_first_contact`, missing required age evidence in reply;
- run 3: `p6_owner_text_only`, missing required messaging evidence in reply.

These are model semantic/quality outcomes, not final provider, parse, or schema failures.

## 4. Static Verification

```text
npm.cmd run build
WORKSPACE_PREFLIGHT=PASS
tsc -p tsconfig.json
exit_code=0

npm.cmd test
Test Files  79 passed (79)
Tests       531 passed (531)
exit_code=0

SECRET_PII_SCAN=PASS
```

## 5. Decision

```text
TARGETED_THREE_STATUS=PASS
EXPANDED_TEN_STATUS=PASS
BASELINE_THIRTEEN_STATUS=FAIL
PACKAGE_12_STATUS=NOT_ELIGIBLE_FOR_CANARY
SHADOW_PACKAGE_OPENED=false
CANARY_PACKAGE_OPENED=false
REAL_OUTBOUND_COUNT=0
PRODUCTION_DEPLOYED=false
```

The initial three expanded scenarios are closed, but the baseline regression gate prevents canary eligibility. No further prompt iteration, model switch, shadow activation, canary activation, or deployment was started automatically.
