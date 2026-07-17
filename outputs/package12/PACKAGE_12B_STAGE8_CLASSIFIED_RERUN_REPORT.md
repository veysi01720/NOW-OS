# Package 12B Stage 8 - Classified Re-run

Date: 2026-07-18

Configured model: `gpt-4.1` (process-local qualification configuration)

## Harness Repair

Scenario-level outcomes now distinguish:

- provider timeout;
- provider rate limit;
- provider connection error;
- provider HTTP error;
- provider abort/unknown error;
- empty provider output;
- malformed JSON;
- model schema rejection;
- model semantic rejection;
- model quality rejection;
- successful validated model output.

Only timeout, rate-limit, connection, HTTP 408, and HTTP 5xx failures are
retryable. The classified rerun allowed at most one transient retry per
scenario. Empty, malformed, schema, semantic, and quality failures were not
retried. No raw error message or raw model output is stored in diagnostics.

Implementation evidence:

- `src/modelAdapter/responsesGoldenReplay.ts`
- `src/tests/modelAdapter/responsesGoldenReplay.test.ts`
- `src/tests/modelAdapter/responsesModelQualification.test.ts`

## Static Verification

```powershell
npm.cmd run build
npm.cmd test -- --run src/tests/modelAdapter/responsesGoldenReplay.test.ts src/tests/modelAdapter/responsesModelQualification.test.ts
```

Result:

- Build: PASS
- Targeted tests: 13/13 PASS
- Retry recovery fixture: PASS
- Sanitized provider classification fixture: PASS
- Empty/malformed/schema/semantic separation fixture: PASS

## Official Three-Run Result

| Run | Score | Unsafe | Provider final failures | Parse failures | Schema rejects | Semantic rejects | Quality rejects | Recovered rate limits |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 13/13 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 2 | 13/13 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| 3 | 12/13 | 0 | 0 | 0 | 0 | 0 | 1 | 5 |

All eight transient failures were `PROVIDER_RATE_LIMIT`. Every one recovered
on the single permitted retry. No timeout, connection, HTTP 5xx, empty output,
malformed JSON, schema rejection, or semantic rejection remained.

Run 3's only final failure:

```text
scenario=p6_text_only
classification=MODEL_QUALITY_REJECTED
retryable=false
reason_codes=REQUIRED_SEMANTIC_EVIDENCE_MISSING,LATEST_MESSAGE_NOT_ANSWERED
```

This is a genuine model quality miss, not infrastructure, but it is within the
accepted one-failure allowance for a 12/13 run.

## Decision

```text
STAGE_8_CLASSIFIED_RERUN=PASS
PACKAGE_12B_STATUS=ELIGIBLE_FOR_OWNER_REVIEW
TARGET_3X_12_OF_13=YES
ZERO_SAFETY_VIOLATIONS=YES
REAL_OUTBOUND_COUNT=0
PACKAGE_12C_OPENED=NO
MODEL_CHANGE_MADE=NO
```

Eligibility is for owner review only. No deployment, canary, model switch, or
production configuration change was performed.

