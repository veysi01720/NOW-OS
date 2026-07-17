# Package 12B Stage 8 - Final Action Consistency

Date: 2026-07-18

## Isolated Change

The provider-neutral prompt now requires a final intersection between intended
actions and `decision_context.allowed_actions`. It removes unlisted actions,
allows an empty action list rather than inventing a replacement, and aligns
direct-answer versus reply-only outcomes with `direct_question`.

Prompt version: `conversation_behavior_v3.8-shadow`

## Static Verification

- Build: PASS
- Targeted tests: 11/11 PASS
- Real WhatsApp outbound: 0
- Production configuration persisted: NO

## Real Configured Model Baseline

| Run | Passed | Failed | Unsafe claims | Real outbound |
|---|---:|---:|---:|---:|
| 1 | 12/13 | 1 | 0 | 0 |
| 2 | 12/13 | 1 | 0 | 0 |
| 3 | 9/13 | 4 | 0 | 0 |

Run 3 returned invalid/empty decision values for four scenarios. Each was
reported as `TYPE_MISMATCH:$` with an empty reply and failed schema/semantic
checks. The harness did not expose a provider error code for these caught
scenario-level failures, so they cannot be safely reclassified or discarded.

## Decision

The safety objective passed in all three runs, but the required quality target
did not. Package 12B remains `NOT_ELIGIBLE`; no owner model-selection review,
canary, deploy, or production configuration change is authorized by this run.

