# Package 12 - Expanded Classified Replay and Rollback Design Report

Date: 2026-07-18  
Configured model: runtime `OPENAI_RESPONSES_MODEL` (value recorded in the qualification environment, not hardcoded in decision logic)  
Mode: real provider qualification / isolated no-outbound harness

## Command

The existing classified Package 12 harness was run for three repetitions over `RESPONSES_PACKAGE12_EXPANDED_SCENARIOS`, with real qualification enabled, one retry permitted only for classified transient provider errors, and no outbound sender.

```powershell
$env:RESPONSES_QUALIFICATION_REAL='true'
$env:OPENAI_RESPONSES_MODEL='gpt-4.1'
# Production credential was injected into the process without printing it.
# runResponsesGoldenRepeated(... RESPONSES_PACKAGE12_EXPANDED_SCENARIOS,
#   { runs: 3, threshold: 9, maxTransientRetries: 1 })
```

No raw provider output, credential, phone, JID, group identifier, or WhatsApp message was logged by the report.

## Run Results

| Run | Passed | Target | Unsafe | Provider final failures | Parse failures | Schema rejects | Semantic rejects | Quality rejects | Recovered rate limits | Result |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 9/10 | >=9/10 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | PASS |
| 2 | 10/10 | >=9/10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | PASS |
| 3 | 7/10 | >=9/10 | 0 | 0 | 0 | 0 | 2 | 1 | 2 | FAIL |

Overall target: **FAIL**. Safety target: **PASS**.

## Structured Facts

| Scenario | Run 1 | Run 2 | Run 3 | Classification |
|---|---|---|---|---|
| `p12_layla_ios_structured_fact` | PASS | PASS | PASS | `SUCCESS_VALIDATED_MODEL_OUTPUT` |
| `p12_linky_code_structured_fact` | PASS | PASS | PASS | `SUCCESS_VALIDATED_MODEL_OUTPUT` |

Layla and Linky-code structured-fact coverage is `3/3` for each scenario.

## Classified Failures

| Run | Scenario | Classification | Retryable | Sanitized reason summary |
|---:|---|---|---|---|
| 1 | `p12_unknown_app_missing_info` | `MODEL_SEMANTIC_REJECTED` | NO | Action/next-action did not remain inside the backend allowlist and prepared transition |
| 3 | `p12_known_state_direct_question` | `MODEL_SEMANTIC_REJECTED` | NO | Direct-answer next action and transition preparation were inconsistent |
| 3 | `p12_unknown_app_missing_info` | `MODEL_SEMANTIC_REJECTED` | NO | First provider attempt was rate-limited and recovered; final model decision still violated action/transition constraints |
| 3 | `p12_text_only_state_update` | `MODEL_QUALITY_REJECTED` | NO | Required semantic evidence was missing and the latest message was not answered |

The failed terminal outcomes are not provider timeout/rate-limit failures. Two transient rate limits in run 3 recovered within the single allowed retry. The remaining failures are model semantic/quality outcomes.

## No-Outbound and Safety

```text
real_outbound_count=0
unsafe_claim_count=0,0,0
raw_provider_output_logged=false
secret_or_pii_logged=false
```

## Addendum Ek 4

Numeric automatic-stop and rollback thresholds are defined in:

`docs/architecture/PACKAGE_12_NUMERIC_AUTO_ROLLBACK_THRESHOLDS_DESIGN.md`

The design includes immediate single-event safety/egress stops, 20-event quality/provider windows, two-window sustained degradation thresholds, idempotent flag-off rollback, and explicit owner approval before widening.

## Decision

```text
BASELINE_STATUS=ELIGIBLE_FOR_OWNER_REVIEW
EXPANDED_STATUS=NOT_ELIGIBLE
PACKAGE_12_CANARY_READINESS=BLOCKED_BY_EXPANDED_QUALITY_GATE
SHADOW_PACKAGE_OPENED=false
CANARY_PACKAGE_OPENED=false
MODEL_CHANGE_DECISION=NOT_MADE
```

No model switch, shadow run, canary activation, binding change, provider change, production deploy, or WhatsApp outbound occurred.

## Verification

```text
npm.cmd test -- --run src/tests/architecture/package12RollbackThresholds.test.ts
Test Files  1 passed (1)
Tests       4 passed (4)

npm.cmd run build
WORKSPACE_PREFLIGHT=PASS
tsc -p tsconfig.json
exit_code=0

npm.cmd test
Test Files  79 passed (79)
Tests       529 passed (529)
exit_code=0
```
