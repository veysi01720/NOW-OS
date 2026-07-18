# Package 12 - Live Shared Context Gap Hotfix Candidate

Status: LOGGED / OWNER DECISION PENDING  
Date: 2026-07-18  
Migration blocker: NO  
Canary scope blocker: NO for greeting-only scope

## Finding

`AllowedActionResolver` is shared by the canonical live Assistants decision
context and the future Responses context.

- `escalate_policy_missing` exists in the live V2 action type but is never
  emitted by `resolveAllowedActions`.
- `record_work_preference` and the associated preference patch fields exist in
  V3.1 but do not exist in the live V2 action/state-patch contract.

The first gap can force a payment or missing-policy question toward another
available action, repair, or safe response instead of an explicit policy
escalation. The second can allow a useful text-only reply while preventing the
live V2 decision from expressing and persisting the preference through the V3
transition contract.

## Sanitized Live Evidence

Read-only window: last 168 hours from the canonical `now_os_backend` runtime.

```text
CONVERSATION_DECISION_V2_TRACE parsed: 5
candidate traces: 5
payment/preference gap-relevant traces: 0
escalate_policy_missing chosen: 0
record_work_preference chosen: 0
raw message/reply/phone/JID logged for this audit: NO
```

Observed affected rate is `0/5`, but this is not a valid impact-rate estimate:
the sample contains no payment or preference event where either missing action
would be applicable. Production frequency and percentage are therefore
`DATA_INSUFFICIENT`, not zero.

## Ownership and Isolation

This is a migration-independent live V2 context capability gap. It must not be
mixed into the Responses qualification or greeting-only canary implementation.
Any later hotfix requires its own owner decision, V2 schema compatibility
review, state-persistence review, combined regression, no-outbound acceptance,
and rollback evidence.

```text
HOTFIX_CANDIDATE=LIVE_SHARED_CONTEXT_GAP
CURRENT_IMPACT_RATE=DATA_INSUFFICIENT
MIGRATION_FLOW_CHANGED=NO
PRODUCTION_CHANGED=NO
OWNER_DECISION_REQUIRED=YES
```
