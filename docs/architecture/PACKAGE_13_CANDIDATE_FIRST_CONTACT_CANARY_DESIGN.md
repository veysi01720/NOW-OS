# Package 13 - Candidate Greeting and First-Contact Canary Design

Status: DESIGN READY / OWNER APPROVAL REQUIRED / NOT IMPLEMENTED  
Date: 2026-07-18

## 1. Objective

Observe the qualified Responses decision path only for private candidate
greeting and first-contact events. This package does not authorize code,
configuration, shadow, canary, deployment, model, provider, or binding changes.

## 2. Current Blockers

Canary must not be armed yet:

1. Package 12 numeric thresholds exist only as design assertions. There is no
   functional automatic-stop evaluator or simulated immediate-stop proof.
2. `modelAdapterFactory.ts` still returns `AssistantAdapter`; the model adapter
   canary selector does not select `ResponsesAdapter`.
3. `modelAdapterSelection.ts` scopes by role and tenant only. It cannot enforce
   a greeting/first-contact intent allowlist.
4. Environment flags are startup configuration. An automatic stop needs an
   immediate runtime deny latch plus idempotent configuration reconciliation;
   changing a process environment variable in memory is not durable rollback.

All four blockers require a separately approved implementation package.

## 3. Exact Eligibility Scope

An event is eligible only when every condition is true:

- canonical tenant;
- sender role `candidate`;
- channel `private`;
- inferred intent exactly `greeting_or_first_contact` or
  `candidate_first_contact`;
- active owner-approved canary window;
- no stop latch;
- deterministic traffic bucket selected;
- stable idempotency reservation succeeds.

Always excluded:

- owner and manager messages;
- groups, commands, approve/reject, training, ZIP, and administrative modes;
- payment, earnings, trust, guarantee, policy-missing, app-selection, setup,
  installation, and preference decisions;
- spoofed, unknown-role, wrong-tenant, duplicate, expired-approval, or
  exhausted-budget events.

An excluded event remains on the current canonical Assistants path and is not
counted as an eligible canary terminal event.

## 4. Proposed Configuration Contract

The approved implementation would use all of the following, default-off:

```text
MODEL_ADAPTER_LAYER_ENABLED=false
MODEL_ADAPTER_CANARY_MODE=tenant_allowlist
MODEL_ADAPTER_CANARY_TENANTS=<canonical-tenant-only>
MODEL_ADAPTER_CANARY_ROLES=candidate
MODEL_ADAPTER_CANARY_INTENTS=greeting_or_first_contact,candidate_first_contact
MODEL_ADAPTER_CANARY_PERCENT=10
RESPONSES_SHADOW_ENABLED=false
```

`MODEL_ADAPTER_CANARY_INTENTS` and `MODEL_ADAPTER_CANARY_PERCENT` are proposed
contracts; they do not exist in runtime code today. Global adapter enable stays
false. The canary mode alone must never broaden selection beyond the tenant,
role, intent, private-channel, approval, and percentage intersection.

## 5. Traffic and Observation Window

- Initial traffic: 10% of eligible events.
- Selection: stable SHA-256 bucket of a sanitized stable event key; raw IDs are
  never logged.
- No automatic widening.
- Short metric window: last 20 eligible terminal events or 15 minutes,
  whichever completes first, matching Addendum Ek 4.
- Fewer than 20 terminal events cannot authorize success or widening; only
  immediate-stop rules are authoritative in an incomplete sample.
- Initial observation ends after 20 eligible terminal events or 24 hours. A
  timeout with fewer than 20 events is `INSUFFICIENT_SAMPLE`, not PASS.
- Any continuation or widening requires explicit owner approval.

## 6. Automatic Stop Evaluation

The first stop criterion is Addendum Ek 4 immediate rule:

```text
unsafe_claim_count >= 1
```

One event atomically latches the cohort stopped before egress. All other Ek 4
immediate, short-window, and sustained thresholds remain unchanged. Backend
validator metrics are authoritative; model self-report cannot clear a stop.

Before arm, a production-function synthetic test must inject an observation
with `unsafe_claim_count=1` and prove:

- exactly one stop decision;
- new reservations denied;
- unsafe egress count zero;
- approval invalidated;
- effective adapter selection off;
- repeated evaluation idempotent;
- observations preserved.

The existing architecture test is not sufficient evidence.

## 7. Manual-Flag-Only Fallback

Ek 3 remains unchanged:

- A failed Responses request does not silently invoke Assistants for the same
  request.
- Invalid or unsafe Responses output never reaches outbound.
- A deterministic backend safety response may be used only when the existing
  egress policy explicitly allows it; this is not provider fallback.
- Returning future requests to Assistants requires the explicit flag-off
  rollback sequence and runtime verification.
- No automatic per-request provider switching, hidden retry to Assistants, or
  model substitution is allowed.

## 8. Six-Step Stop and Rollback Sequence

The controller must implement Addendum Ek 4 in this exact order:

1. Make `MODEL_ADAPTER_CANARY_MODE=off` effective immediately through the
   runtime stop latch, then persist/reconcile the configured value to `off`.
2. Make `MODEL_ADAPTER_LAYER_ENABLED=false` effective if mode isolation is not
   sufficient, then persist/reconcile the configured value to `false`.
3. Invalidate the active canary approval and prevent new reservations.
4. Let reserved work finish only for non-immediate degradation stops. For an
   immediate security/egress stop, block egress and use only the existing safe
   backend path where allowed.
5. Verify connection doctor reports the adapter decision disabled and the stop
   reason through sanitized fields.
6. Preserve observations and counters; never reset the database.

The sequence is idempotent. One threshold event creates one stop record.
Re-arm requires fresh qualification and fresh owner approval.

## 9. Required Observability

Sanitized terminal observations must include:

- eligibility reason and hashed event key;
- intent category, role category, channel category, and tenant-match boolean;
- traffic bucket and reservation result;
- schema, semantic, transition, and final egress validation results;
- unsafe-claim count, fallback origin, provider classification, retry recovery,
  latency, outbound count, and hash-chain match;
- stop threshold ID, stop-latch status, approval status, and terminal status.

No raw prompt, message, reply, phone, JID, group ID, API key, provider payload,
or secret may be stored.

## 10. Acceptance Before Arm

Implementation may be considered arm-ready only when:

1. combined 23-scenario qualification remains green in all three runs;
2. functional immediate-stop simulation passes;
3. intent/role/channel/tenant negative routing tests pass;
4. payment and approve/reject events prove Responses is not called;
5. manual-flag-only fallback test passes;
6. reservation and terminal observation are idempotent;
7. final outbound/hash-chain guard passes with a no-outbound spy;
8. connection doctor reports effective stop state;
9. build, full tests, source integrity, and secret/PII scan pass;
10. owner approves the exact runtime configuration and window.

```text
DESIGN_STATUS=READY_FOR_OWNER_REVIEW
CANARY_CODE_WRITTEN=NO
SHADOW_OR_CANARY_FLAG_OPENED=NO
CURRENT_ARM_STATUS=BLOCKED_BY_FUNCTIONAL_STOP_AND_INTENT_SCOPE
```
