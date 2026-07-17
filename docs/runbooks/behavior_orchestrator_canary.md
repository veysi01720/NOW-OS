# Behavior Orchestrator Canary Runbook

## Purpose

Use this runbook to validate behavior orchestration in a controlled internal scope before production rollout.

## Preconditions

- Full test suite passes.
- Architecture seal tests pass.
- Feature flag default remains off.
- Contract v1.0 remains unchanged.
- Public reply only is verified.

## Enablement

Preferred canary scope is tenant or internal-owner scoped. If only a global environment flag is available, do not enable global production traffic. Use a controlled internal runtime only.

Rollback method:

```text
BEHAVIOR_ORCHESTRATOR_ENABLED=false
```

## Metrics To Watch

- Behavior flag status
- Response objective
- Desired length
- Knowledge usage boolean
- User stage before and after
- Transition applied or rejected
- Context budget count
- Reply length
- Repetition signals
- Safe trust wording
- Contract validation result

## Stop Conditions

Turn the flag off if any of these occur:

- Internal note leak
- Raw model output sent
- Unsafe trust or guarantee wording
- Repeated long answers
- Unauthorized command reaches the assistant
- Group safe-ignore is bypassed
- Contract validation failures increase

## Verification Checklist

- Internal notes are not sent.
- Public reply only is sent.
- Long or repetitive answers are reduced.
- Trust wording remains careful and non-guaranteed.
- Backend validation owns state transitions.
- Rollback returns traffic to legacy behavior.
