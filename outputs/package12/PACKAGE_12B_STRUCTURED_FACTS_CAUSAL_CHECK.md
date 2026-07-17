# Package 12B - Structured Facts Causal Check

Generated: 2026-07-18

## Decision

```text
STRUCTURED_FACTS_PRIMARY_ROOT_CAUSE=NO
PACKAGE_06_SCORE_DIRECTLY_COMPARABLE=NO
ANOTHER_REGRESSION_SOURCE_CONFIRMED=YES
```

## Controlled Change

Only the structured-facts experiment was applied:

1. `structured_facts` was added to `ResponsesDecisionContext`.
2. The baseline fixture received the existing owner-approved structured app
   facts block.
3. The system instruction identified `structured_facts` as an exact
   backend-approved source.
4. Projection tests were added.

No validator, schema, next-action compatibility rule, threshold, model,
sampling option, provider, state transition, or scenario expectation was
changed.

Files:

- `src/modelAdapter/responsesDecisionPrompt.ts`
- `src/modelAdapter/responsesGoldenReplay.ts`
- `src/tests/modelAdapter/responsesDecisionPrompt.test.ts`

Diff size before the experiment run:

```text
3 files changed, 13 insertions, 9 deletions
```

## Current V3.1 Baseline After Structured Facts Projection

Model: `gpt-4.1`

| Run | Score | Schema | Unsafe claims |
| --- | --- | --- | --- |
| 1 | 8/13 | 100% | 2 |
| 2 | 8/13 | 100% | 1 |
| 3 | 7/13 | 100% | 1 |

The score did not return to the historical 11/13 level. The structured-facts
projection hypothesis is therefore rejected as the primary explanation for
the baseline score difference.

The change remains architecturally required for exact NİVİ/Linky facts, but it
does not repair the baseline semantic/transition failures.

## Package 06 Control Run With The Same Model

The untouched historical Package 06 harness was run again with the same
`gpt-4.1` model and credential source.

| Run | Score | Schema | Unsafe claims |
| --- | --- | --- | --- |
| 1 | 10/13 | 100% | 0 |
| 2 | 11/13 | 100% | 0 |
| 3 | 9/13 | 100% | 1 |

This reproduces the historical Package 06 score band while the current V3.1
harness remains at 7-8/13.

## Confirmed Primary Difference

The Package 06 and Package 12 scores measure different contracts.

Package 06:

- ConversationDecision schema `3.0`;
- model `quality_signals` treated as pass evidence;
- no backend semantic validator;
- no state-patch evidence requirement;
- no transition-preparation validation;
- action and orchestration namespaces were partially conflated.

Current Package 12:

- ConversationDecision schema `3.1`;
- backend-computed quality metrics are authoritative;
- semantic validator is mandatory;
- state-patch evidence is mandatory;
- transition preparation is evaluated;
- chosen domain actions and orchestration `next_action` are separate.

Evidence:

- Historical evaluator:
  `work/package06_golden_replay/src/modelAdapter/responsesGoldenReplay.ts`
- Current evaluator:
  `src/modelAdapter/responsesGoldenReplay.ts`
- V3.1 contract record:
  `docs/architecture/PACKAGE_08_CONVERSATION_DECISION_V3_CONTRACT_COMPLETION.md`
- Semantic validator:
  `src/intelligence/conversation/ConversationDecisionV3SemanticValidator.ts`
- Transition preparation:
  `src/intelligence/conversation/ConversationDecisionV3TransitionPreparation.ts`

Conclusion: the apparent 11/13 to 7-8/13 regression is primarily a
measurement/contract hardening effect, not a loss caused by missing structured
facts.

## Additional Concrete Regression Source

The baseline expectations were not fully reconciled after
`escalate_missing_info` was added.

Observed consistently:

- `p6_payment_unverified` selected `escalate_missing_info`, which the current
  prompt and semantic transition allow, but the baseline expected-next-action
  list does not allow.
- `p6_prompt_injection` also selected `escalate_missing_info`, while its
  baseline expected-next-action list still reflects the older contract.

Both scenarios therefore fail with `NEXT_ACTION_MISMATCH` even when schema and
semantic validation pass. This is a stale fixture/contract alignment issue,
not evidence that the model failed to produce strict JSON.

Other Package 12B work remains separate:

- compact-intake patch/next-action alignment;
- owner text-only authority versus candidate-state mutation;
- unapproved-app echo prevention;
- manager unsafe wording;
- adversarial next-action calibration.

## Verification

Build:

```text
npm.cmd run build
WORKSPACE_PREFLIGHT=PASS
tsc -p tsconfig.json
```

Targeted tests:

```text
npm.cmd test -- --run src/tests/modelAdapter/responsesDecisionPrompt.test.ts src/tests/modelAdapter/responsesGoldenReplay.test.ts src/tests/modelAdapter/responsesModelQualification.test.ts src/tests/modelAdapter/responsesAdapter.contract.test.ts
Test Files 4 passed (4)
Tests 18 passed (18)
```

Full suite:

```text
npm.cmd test -- --silent --reporter=default
Test Files 78 passed (78)
Tests 522 passed (522)
```

## Safety

- production deploy: NO
- production environment persisted: NO
- provider/model binding changed: NO
- live canary: NO
- real WhatsApp/Evolution outbound: 0
- state/database/queue writes: 0
- raw model replies persisted: NO
- secrets or PII printed: NO
