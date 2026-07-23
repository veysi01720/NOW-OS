# Claude Decision Brief

Use this brief when asking Claude for a recommendation.

## Current Decision

We reached Package 13 readiness, but live bot quality is still weak. The bot now replies again after a P0 production fix, but the answer quality and speed are not yet good enough.

Main question:

Should we continue Package 13 canary now, or first run a focused AI quality phase?

## Facts

- Package 12 reached `ELIGIBLE_FOR_CANARY`.
- Package 13 owner approval / canary safety mechanics exist.
- P0 production outage was fixed and deployed at commit `71e775f`.
- Candidate private messages now receive replies.
- A live reply took about 10.7 seconds.
- Measured delay:
  - 97 ms normalize to model start
  - 8827 ms model execution
  - 1774 ms send
- A local latency fix is implemented but not committed/deployed.
- Local latency fix full suite: 84/84 files, 570/570 tests PASS.
- The bot still feels weak because the real conversation quality layer has not been systematically improved with live failure examples.

## Proposed Path

Recommended path:

1. Review local latency fix.
2. Deploy if safe.
3. Validate faster live response.
4. Collect 10-30 bad live conversation examples.
5. Convert them into golden tests.
6. Improve policy facts and deterministic replies.
7. Resume Package 13 canary.

## Claude Questions

1. Is this prioritization correct?
2. Should Package 13 canary wait until after the quality corpus?
3. Is the deterministic latency fast-path safe enough?
4. What should be the first 10 golden tests for real bot quality?
5. What should remain model-generated vs deterministic?
6. What is the smallest next package that will make the bot feel better?

## Requested Output From Claude

Please return:

- PASS/REVISE recommendation for the latency fix strategy.
- Recommended next package name and scope.
- Top 10 quality regression tests to add.
- Risks to watch before deploying canary.
- A yes/no answer: continue canary now, or quality phase first?

