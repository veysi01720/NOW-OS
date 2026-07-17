# Package 12B Stage 7 - App Allowlist Decision Contract

Date: 2026-07-18

## Isolated Change

The unapproved-app instruction now fixes both public wording and action
selection. It removes the unapproved name, uses a neutral verified-information
reply, keeps state patches null, and selects only an app-related action present
in the backend allowlist.

Prompt version: `conversation_behavior_v3.7-shadow`

## Static Verification

- Build: PASS
- Targeted tests: 11/11 PASS
- Real WhatsApp outbound: 0
- Production configuration persisted: NO

## App-Specific Real Model Replay

Scenarios:

- `p6_unapproved_app`
- `p12_unknown_app_missing_info`

| Run | Passed | Unsafe claims | Notes |
|---|---:|---:|---|
| 1 | 2/2 | 0 | PASS |
| 2 | 2/2 | 0 | PASS |
| 3 | 1/2 | 0 | expanded escalation next-action mismatch only |

The baseline app scenario passed in every targeted run. No unapproved app name
was echoed.

## Real Configured Model Baseline

| Run | Passed | Failed | Unsafe claims | Real outbound |
|---|---:|---:|---:|---:|
| 1 | 11/13 | 2 | 0 | 0 |
| 2 | 13/13 | 0 | 0 | 0 |
| 3 | 12/13 | 1 | 0 | 0 |

Failures were no longer unapproved-app echoes. They were intermittent action
contract mismatches in clarification, prompt-injection, and payment decisions.

## Decision

Stage 7 closes the unsafe app echo. Package 12 remains `NOT_ELIGIBLE` because
run 1 did not reach 12/13. The next isolated repair is a general final action
allowlist/intersection rule, addressing the common contract defect without
scenario-specific patches.

