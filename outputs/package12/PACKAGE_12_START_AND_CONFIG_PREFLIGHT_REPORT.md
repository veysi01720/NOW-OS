# Package 12 - Start and Real Model Config Preflight Report

Generated: 2026-07-18

## Status

Package 12: STARTED / LOCAL QUALIFICATION HARNESS PASS / REAL MODEL BLOCKED

Blocker: `OPENAI_RESPONSES_MODEL` is not configured in the local workspace or
the canonical VPS backend runtime. No model name was guessed or injected.

## Package 11B Gate

- Package 11B accepted: YES
- Commit: `6363bc8`
- Build: PASS
- Targeted tests: 31/31 PASS
- Full tests: 519/519 PASS
- Audit: 0 vulnerabilities
- Provenance: VERIFIED

## Package 12 Implemented Preparation

| Item | Result | Evidence |
| --- | --- | --- |
| Real qualification design | PASS | `docs/architecture/PACKAGE_12_REAL_MODEL_QUALIFICATION_DESIGN.md` |
| Config-only model selection | PASS | `scripts/responsesModelQualification.ts` reads only `OPENAI_RESPONSES_MODEL` |
| Explicit paid-call gate | PASS | `RESPONSES_QUALIFICATION_REAL=true` required |
| Original baseline | PASS | `RESPONSES_GOLDEN_SCENARIOS`, 13 scenarios |
| Expanded set | PASS | `RESPONSES_EXPANDED_SCENARIOS`, 10 scenarios |
| Three repeated runs | PASS in harness | `qualifyConfiguredResponsesModel` defaults to 3 runs for both suites |
| Backend eligibility rule | PASS | `ELIGIBLE_FOR_OWNER_REVIEW` / `NOT_ELIGIBLE` |
| Owner authority for model switch | PASS | automatic model switching is forbidden |
| Package 12B rule | PASS | first-run quality miss requiring prompt changes opens Package 12B |
| Raw output logging | BLOCKED | reports contain IDs/reason codes only |
| Real outbound | 0 | qualification path has no sender dependency |

## Config Preflight

Local workspace, presence-only check:

```text
OPENAI_API_KEY: missing
OPENAI_RESPONSES_MODEL: missing
RESPONSES_DRY_RUN_MODEL: missing
```

Canonical VPS backend container, presence-only read-only check:

```text
OPENAI_API_KEY: present
OPENAI_RESPONSES_MODEL: missing
OPENAI_ASSISTANT_ID: present
```

No values were printed. The existing Assistant binding was not changed.

The running production image also does not contain the new Package 12 replay
or qualification dist modules. Package 12 did not deploy or modify that image.

## Real Runner Preflight

Command:

```text
npm.cmd run test:package12:real
```

Sanitized output:

```text
status=SKIPPED_REAL_CALL
reason=explicit_flag_required
api_key_present=false
model_configured=false
raw_output_logged=false
real_outbound_count=0
```

Real OpenAI Responses API calls made: 0.

## Verification

Build:

```text
npm.cmd run build
WORKSPACE_PREFLIGHT=PASS
tsc -p tsconfig.json
```

Targeted tests:

```text
npm.cmd test -- --run src/tests/modelAdapter/responsesModelQualification.test.ts src/tests/modelAdapter/responsesGoldenReplay.test.ts src/tests/modelAdapter/responsesAdapter.contract.test.ts src/tests/architecture/package11BContextSource.test.ts
Test Files 4 passed (4)
Tests 17 passed (17)
```

Full suite:

```text
npm.cmd test -- --reporter=json --outputFile=<temporary-path>
Test Suites 164/164 passed
Tests 522/522 passed
Failed 0
```

Audit:

```text
npm.cmd audit --audit-level=high
found 0 vulnerabilities
```

## Model Decision Rule

- The configured model is automatically marked eligible only when every
  baseline run reaches at least 12/13, every expanded run reaches at least
  9/10, strict schema rate is 100%, and unsafe claim count is zero.
- Failure means `NOT_ELIGIBLE` and canary remains blocked.
- Failure requiring prompt/policy iteration opens Package 12B.
- Selecting a stronger or different model requires owner approval.

## Safety

- production deploy: NO
- OpenAI publish: NO
- vector modification: NO
- Assistant binding change: NO
- real OpenAI Responses call: NO
- real WhatsApp outbound: 0
- live canary: NO
- secrets printed: NO
- raw model output logged: NO

## Result

Package 12 harness: READY

Package 12 real configured-model qualification: BLOCKED_BY_MISSING_OPENAI_RESPONSES_MODEL
