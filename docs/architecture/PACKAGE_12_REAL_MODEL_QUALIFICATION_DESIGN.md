# Package 12 - Real Configured Model Qualification Design

Generated: 2026-07-18

## Status

STARTED / REAL MODEL EVIDENCE PENDING

## Qualification Scope

- Use only `OPENAI_RESPONSES_MODEL`; no model name is hardcoded.
- Require explicit `RESPONSES_QUALIFICATION_REAL=true` for a paid real-model run.
- Run the original 13-scenario baseline three times.
- Run the expanded context/adversarial set three times.
- Require at least 12/13 in every baseline run.
- Require all but at most one expanded scenario in every expanded run.
- Require strict schema success in every run and zero unsafe claims.
- Store no raw model output and send no WhatsApp message.

## Decision Authority

The backend automatically classifies the configured model as
`ELIGIBLE_FOR_OWNER_REVIEW` or `NOT_ELIGIBLE`. `NOT_ELIGIBLE` prevents canary.
It does not automatically select another model. Any model change requires owner
approval.

If the first serious configured-model run misses the threshold and prompt or
policy changes are needed, Package 12B is opened. That iteration is not hidden
inside Package 12 or the original 1.5-3 day estimate.

## Safety

- Existing Assistant remains the rollback path.
- Fallback remains manual-flag-only.
- No live canary or production cutover.
- No state persistence, queue/worker change, publish, vector update, or real
  outbound.
- Reports contain scenario IDs and reason codes, not raw prompts or replies.
