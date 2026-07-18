# Package 12 - Numeric Automatic Rollback Thresholds Design (Addendum Ek 4)

Status: DESIGN READY / RUNTIME EVALUATOR NOT IMPLEMENTED / NOT ENABLED
Date: 2026-07-18  
Scope: future Responses shadow, scoped canary, and cutover only

## 1. Decision

No shadow or canary is enabled by this document. The current default remains:

```text
MODEL_ADAPTER_LAYER_ENABLED=false
MODEL_ADAPTER_CANARY_MODE=off
```

The fallback policy remains `manual-flag-only` for individual requests. Automatic action in this design means stopping the observation/canary cohort and returning the adapter selection to flag-off. It does not silently fail over one failed message to another model or API.

## 2. Metric Ownership

The backend owns threshold evaluation. Model self-report fields are not metrics. Only sanitized backend observations may be used:

- schema and semantic validator results
- transition preparation result
- provider error classification and retry result
- safe fallback origin
- terminal status
- outbound count and final reply hash-chain result
- role, tenant, channel, and approval gate result
- latency measured by the backend

Raw prompts, replies, phone numbers, JIDs, group identifiers, provider payloads, API keys, and secrets are excluded.

## 3. Evaluation Windows

| Window | Definition | Purpose |
|---|---|---|
| Immediate | One observed event | Security, authorization, egress, and data-integrity failures |
| Short | Last 20 eligible terminal events or 15 minutes, whichever completes first | Quality and provider health |
| Sustained | Two consecutive short windows | Non-critical latency and retry degradation |

An empty or incomplete window cannot authorize a wider cohort. A window with fewer than 20 terminal events may only trigger immediate-stop rules; it cannot be used to claim canary success.

## 4. Automatic Stop Thresholds

### 4.1 Immediate stop: one event is enough

| Metric | Numeric threshold | Action |
|---|---:|---|
| `unsafe_claim_count` | `>= 1` | Stop cohort immediately |
| internal note or raw model output selected for outbound | `>= 1` | Stop cohort immediately |
| PII, secret, raw phone/JID/group ID, or raw prompt/reply logged | `>= 1` | Stop cohort immediately |
| unauthorized role, tenant, group, spoof, or expired approval uses Responses path | `>= 1` | Stop cohort immediately |
| `outbound_count != 1` for an eligible send event | `>= 1` | Stop cohort immediately |
| final validator input hash, selected reply hash, and send payload hash mismatch | `>= 1` | Stop cohort immediately |
| state transition applied after failed semantic validation or failed transition preparation | `>= 1` | Stop cohort immediately |
| fake/unknown link promoted as approved | `>= 1` | Stop cohort immediately |

### 4.2 Short-window stop: minimum 20 terminal events

| Metric | Numeric threshold | Action |
|---|---:|---|
| `safe_fallback_rate` | `> 5%` | Stop cohort |
| `validator_reject_rate` | `> 10%` | Stop cohort |
| schema/parse rejection rate | `> 2%` | Stop cohort |
| final provider failure rate after allowed retry | `> 5%` | Stop cohort |
| terminal failure rate (`provider`, `timeout`, `contract`, `send`) | `> 5%` | Stop cohort |
| model-origin decision acceptance rate | `< 90%` | Stop cohort |

Rates use eligible terminal observations as denominator. Retries are not separate denominator events. A recovered retry remains one terminal success but contributes to the retry-pressure metric.

### 4.3 Sustained degradation: two consecutive short windows

| Metric | Numeric threshold | Action |
|---|---:|---|
| transient provider retry rate | `> 20%` in both windows | Stop cohort |
| backend-measured p95 model latency | `> 12,000 ms` in both windows | Stop cohort |
| timeout rate before retry recovery | `> 10%` in both windows | Stop cohort |

The sustained rule avoids rollback from a single brief rate-limit burst while still stopping a repeatedly degraded canary.

## 5. Qualification Gates Before Any Canary

The following are preconditions, not runtime percentages:

1. Baseline set: each of three runs must pass at least `12/13`, with zero safety violations.
2. Expanded adversarial set: each of three runs must pass at least `9/10`, with zero safety violations.
3. Layla structured-fact scenario must pass `3/3`.
4. Linky-code structured-fact scenario must pass `3/3`.
5. Provider/parse/schema failures must be classified and sanitized.
6. Build, full tests, no-outbound acceptance, and source provenance must pass.

Failure of any precondition means `NOT_ELIGIBLE_FOR_CANARY`; it does not trigger a production rollback because no production cutover has occurred.

## 6. Stop and Rollback Sequence

Threshold evaluation must be idempotent. The first tripped threshold creates one sanitized stop decision and performs:

1. Set `MODEL_ADAPTER_CANARY_MODE=off`.
2. Set `MODEL_ADAPTER_LAYER_ENABLED=false` if the cohort cannot be isolated by mode alone.
3. Invalidate the active canary approval and prevent new reservations.
4. Allow already-reserved work to finish only when no immediate security/egress rule fired; otherwise block egress and use the existing safe backend path.
5. Confirm connection doctor reports the adapter decision as disabled.
6. Preserve observations and counters for review; do not reset the database.

If a later production cutover changes a binding, rollback additionally restores the immutable pre-cutover binding snapshot. No binding change exists in Package 12.

## 7. Calibration and Widening

- Thresholds are locked before the first shadow/canary package.
- A threshold may be relaxed only by a new owner-reviewed design change backed by replay and shadow evidence.
- A successful 20-event window does not permit automatic widening. Widening always requires explicit owner approval.
- Any stop requires a fresh qualification run and fresh owner approval before re-arm.

## 8. Current Package 12 Decision

The final deduplicated combined qualification executed the same 23 model outputs
against baseline, targeted, and expanded membership in each run. All three runs
scored baseline `13/13`, targeted `3/3`, and expanded `10/10`, with zero safety
violations.

Qualification eligibility does not mean that automatic-stop is operational.
`src/tests/architecture/package12RollbackThresholds.test.ts` verifies this
design text only. No runtime threshold evaluator, stop latch, approval
invalidation controller, or simulated immediate-stop execution test exists yet.
That functional implementation and proof are mandatory before canary arm.

```text
PACKAGE_12_QUALIFICATION_STATUS=ELIGIBLE_FOR_CANARY
FUNCTIONAL_AUTOMATIC_STOP_READY=NO
SHADOW_OR_CANARY_OPENED=false
```
