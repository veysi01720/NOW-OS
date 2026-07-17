# Package 11 - Prompt / Decision Policy Repair Design

Generated: 2026-07-18

## Status

Design only. Implementation has not started.

## Purpose

Package 11 repairs the Responses ConversationDecisionV3 prompt and policy
evaluation path after Package 09 semantic enforcement and Package 10
transition-preparation are in place.

Package 11 must improve model decision quality without enabling live Responses,
without changing the primary Assistant binding, and without sending WhatsApp
messages.

## Non-Negotiables

- No production deploy.
- No live/canary activation.
- No real WhatsApp outbound.
- No OpenAI publish or vector changes.
- No queue/worker cutover.
- No model-specific branching.
- No state write from model output.
- Existing Assistant path remains rollback and primary runtime until later
  explicit cutover.

## Model-Agnostic Rule

The model name must remain runtime configuration, not logic.

Accepted:

- `OPENAI_RESPONSES_MODEL` / `openaiResponsesModel` read from config.
- adapter identity and logs may include model name for reporting.
- tests may use fake model names such as `gpt-test-responses`.

Forbidden:

- `if model === "gpt-4.1-mini"` or equivalent.
- scenario-specific behavior based on model name.
- prompt text that assumes a specific model.
- threshold exceptions for one specific model.

Package 11 target wording may refer to "configured Responses model". Historical
quality reports may mention previous measured models, but implementation must be
model-agnostic.

## Quality Target

The target from the previous quality plan remains unchanged:

- at least 3 repeated replay runs;
- each run must reach at least `12/13` pass (`>= 92.3%`);
- unsafe claim count = 0;
- unapproved app mention = 0;
- action allowlist violations = 0;
- state patch mismatch = 0;
- transition-prep invalid = 0 for scenarios requiring state transition;
- real outbound = 0.

If the configured model does not meet this target, it is not eligible for live
canary. Package 12 may compare another configured model, but the code path must
remain model-agnostic.

## Ek 1 - Self-Report Risk Handling

Package 11 must stop treating model self-report fields as pass evidence.

The schema keeps:

- `quality_signals`
- `self_check`

But Package 11 replay must compute deterministic quality metrics in backend
code and compare them with model self-report fields.

Required metrics:

- answered latest message;
- no generic closer;
- no invented policy;
- did not repeat known information;
- correct role boundary;
- no forbidden unsafe wording;
- required semantic evidence present;
- state patch matched deterministic transition-prep;
- action allowlist respected.

Decision rule:

- validator-computed metrics are authoritative;
- model self-report is diagnostic only;
- if model self-report says pass but validator says fail, the scenario fails;
- mismatch count is recorded for Package 12 model selection.

## Ek 3 - Fallback Type Decision

Package 11 keeps the fallback type as `manual-flag-only`.

Reason:

- runtime-automatic fallback could hide schema/prompt failures during replay;
- automatic failover would make quality metrics ambiguous;
- current migration goal is measurable shadow quality, not live provider
  resilience;
- rollback is already clear through flags.

Required tests:

- Responses invalid output does not automatically call Assistant fallback in
  replay/shadow;
- manual flag-off leaves the existing Assistant path available;
- fallback type is documented in the Package 11 acceptance report;
- no per-message automatic failover is introduced.

## Prompt / Policy Repair Scope

Package 11 may update:

- `src/modelAdapter/responsesDecisionPrompt.ts`
- `src/modelAdapter/responsesGoldenReplay.ts`
- deterministic replay validators/evaluators;
- Package 11 tests and reports.

Package 11 must not:

- change provider binding;
- add live outbound;
- apply state patches;
- enable Responses shadow/canary by default;
- modify production knowledge content;
- fix Package 04 fixture by copying production data into a historical workspace.

## Planned Prompt Repairs

Repair areas:

1. Ask only the latest needed thing.
2. Answer direct work-model questions instead of generic fallback.
3. Use `escalate_missing_info` when required operational knowledge is absent.
4. Preserve approved app gate.
5. Avoid candidate setup/install guidance before work model acceptance.
6. Use `update_candidate_state` only with current-message evidence.
7. Use concise Turkish, no generic closers.
8. Avoid self-reported quality optimism by requiring backend validators.

## Package 04 Fixture / Ek 6 Decision

Package 04 rerun failure is not fixed inside Package 11 prompt repair.

Decision: create a separate context-source hardening package before Package 12
model selection, and combine the Package 04 fixture issue with Ek 6 structured
facts separation there.

Reason:

- Package 04 failure is immediate fixture/path availability.
- Ek 6 is deeper knowledge/context architecture: exact app facts and numeric
  facts should be structured and testable, not only markdown blob text.
- Mixing structured facts migration into Package 11 prompt repair would blur
  prompt quality with context-source integrity.

Planned package name:

```text
Package 11B - Context Source Hardening / Structured Facts
```

Expected scope:

- create or validate `app_facts_structured.json`;
- keep `app_facts.md` as official narrative source;
- update context builder to include structured facts separately;
- repair fixture path handling so tests do not depend on missing production
  `data/knowledge_bank/app_facts.md`;
- source integrity tests for markdown + structured facts.

## Package 11 Acceptance Criteria

Package 11 can be accepted only if:

- model agnosticism check still passes;
- build passes;
- full tests pass;
- targeted replay evaluator tests pass;
- at least 3 no-outbound replay runs are recorded for the configured model;
- target score is reached or the model is explicitly marked not eligible;
- self-report mismatch metrics are present;
- validator-computed metrics are authoritative;
- manual-flag-only fallback is tested;
- real outbound count is 0;
- state write count is 0;
- Package 04/Ek 6 remains tracked as Package 11B, not silently marked fixed.

## Rollback

Rollback remains flag-off:

```text
RESPONSES_SHADOW_ENABLED=false
RESPONSES_SHADOW_MODE=off
MODEL_ADAPTER_LAYER_ENABLED=false
MODEL_ADAPTER_CANARY_MODE=off
```

Since Package 11 is replay/shadow-only, rollback means not consuming Package 11
prompt changes in live traffic.
