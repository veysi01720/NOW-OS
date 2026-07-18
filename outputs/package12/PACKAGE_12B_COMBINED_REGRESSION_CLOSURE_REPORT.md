# Package 12B - Combined Regression Closure Report

Date: 2026-07-18  
Configured model: process-local `OPENAI_RESPONSES_MODEL`  
Production deploy: NO  
Shadow/canary enabled: NO

## Historical Classification

| Scenario | Classification | Evidence |
|---|---|---|
| `p6_payment_unverified` | PRE-EXISTING | `PACKAGE_12_REAL_MODEL_QUALIFICATION_REPORT.md` records failure in runs 1, 2, and 3. Stage 1 later aligned its valid escalation expectation. |
| `p6_owner_text_only` | PRE-EXISTING / INTERMITTENT | `PACKAGE_12_REAL_MODEL_QUALIFICATION_REPORT.md` records failure in runs 1 and 3. |
| `p6_first_contact` | NEW IN THE ACTION-ALIGNMENT REVISION | No earlier Package 12 report records it as a failure. The prior classified Stage 8 report had only `p6_text_only` as its final miss; the action-alignment report first records `p6_first_contact`. |

## Isolated Root Causes and Minimal Fixes

| Scenario | Root cause | Minimal closure |
|---|---|---|
| `p6_payment_unverified` | The unknown-app instruction was not intent-scoped, allowing payment language to be misclassified and routed to `ask_selected_app`. | Scope unknown-app behavior to app intents and add an exact unverified-payment escalation rule. |
| `p6_first_contact` | Action selection was valid, but the model could omit one requested intake concept from the reply. | Backend context projects missing first-contact concepts through `required_reply_terms`. |
| `p6_owner_text_only` | Backend required the grounded app name but did not require the explicit messaging acknowledgement. | Backend context projects `mesajlaşma` for text-only requests, alongside a grounded app when applicable. |

The first combined run also exposed two cross-set consistency gaps. Direct structured-app questions now project the exact approved fact required by the query, and the guarantee-pressure fixture accepts the already-valid `escalate_missing_info` outcome. No shared resolver, V2 schema, persistence, live adapter binding, or outbound path was changed.

## Standard Combined Procedure

`npm.cmd run test:package12:combined-real` is now the qualification command after every decision-context, prompt, schema, validator, transition, or fixture change.

- Baseline membership: 13 scenarios, target at least 12/13 per run.
- Targeted membership: 3 scenarios, target 3/3 per run.
- Expanded membership: 10 scenarios, target at least 9/10 per run.
- The targeted three are a subset of the expanded ten.
- The deduplicated catalog contains 23 scenarios, not 26.
- Each of the 23 scenarios is called once per run.
- All three membership scores are derived from the same outputs in each run.
- Every run must meet every suite target with zero unsafe claims.

Implementation evidence:

- `scripts/responsesQualificationSuite.ts`
- `src/modelAdapter/responsesGoldenReplay.ts`
- `package.json` script `test:package12:combined-real`
- `src/tests/modelAdapter/responsesGoldenReplay.test.ts`

## Final Real-Model Combined Qualification

Command:

```powershell
$env:RESPONSES_QUALIFICATION_REAL='true'
$env:OPENAI_RESPONSES_MODEL='<configured-model>'
npm.cmd run test:package12:combined-real
```

Credentials were supplied process-locally, not printed or written.

| Run | Unique calls | Baseline | Targeted | Expanded | Unsafe | Final failures | Recovered transient rate limits |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 23 | 13/13 | 3/3 | 10/10 | 0 | 0 | 2 |
| 2 | 23 | 13/13 | 3/3 | 10/10 | 0 | 0 | 8 |
| 3 | 23 | 13/13 | 3/3 | 10/10 | 0 | 0 | 11 |

All transient failures were recovered by the existing single-retry policy. No final provider, parse, schema, semantic, or quality failure remained. Real outbound count was zero and raw output was not logged.

## Static Verification

```text
npm.cmd run build
WORKSPACE_PREFLIGHT=PASS
tsc -p tsconfig.json
exit_code=0

npm.cmd test
Test Files  79 passed (79)
Tests       534 passed (534)
exit_code=0

MODEL_SPECIFIC_BRANCHING=NONE
SECRET_PII_SCAN=PASS
```

## Decision

```text
PACKAGE_12_COMBINED_REGRESSION_STATUS=PASS
BASELINE_3X_TARGET=PASS
TARGETED_3X_TARGET=PASS
EXPANDED_3X_TARGET=PASS
ZERO_SAFETY_VIOLATIONS=YES
PACKAGE_12_STATUS=ELIGIBLE_FOR_CANARY
CANARY_STARTED=NO
SHADOW_STARTED=NO
PRODUCTION_DEPLOYED=NO
REAL_OUTBOUND_COUNT=0
```

Eligibility is a qualification result only. It does not activate shadow, canary, production routing, model selection, or deployment.
