# Package 12C - Deterministic Missing-Policy Action Normalization Design

Generated: 2026-07-18

## Status

Design prepared for owner review. **No implementation has started.**

```text
CODE_CHANGED=NO
PROMPT_CHANGED=NO
VALIDATOR_CHANGED=NO
ALLOWED_ACTION_RESOLVER_CHANGED=NO
CANARY_ARMED=NO
DEPLOY_EXECUTED=NO
```

## Purpose

`p12_unknown_app_missing_info` has a pre-existing intermittent model action
consistency failure. The user-facing safety checks remain effective, but the
model varies the control tuple formed by `chosen_actions`, `next_action`,
`requires_escalation`, and `escalation_reason` for the same backend-known
missing-policy condition.

Package 12C will make that narrow control tuple deterministic without weakening
the qualification target, changing the prompt to chase one output sample, or
changing the live Assistants path.

## Non-Negotiables

- No aggregate `8/9` tolerance replaces targeted `3/3`.
- No broad prompt rewrite.
- No state write or outbound inside normalization.
- No reply-text rewriting or forbidden-term removal inside normalization.
- No invented policy fact, app, code, link, or escalation fact.
- No owner, manager, group, payment, trust, or prompt-injection normalization.
- No mutation inside the semantic validator.
- No change to `AllowedActionResolver`.
- No change to the Assistants/V2 execution branch.
- Canary and shadow flags remain off until the full acceptance gate passes.

## 1. Exact Architectural Location

### Decision

Normalization belongs at a **V3 post-shape, pre-semantic canonicalization
boundary**.

The intended order is:

```text
Responses provider output
-> JSON parse
-> V3 shape validation
-> deterministic missing-policy trigger resolution
-> V3 action-control canonicalization
-> existing V3 semantic validator
-> existing transition preparation
-> existing quality / egress guards
-> existing single outbound boundary
```

### Why not transition-prep?

`ConversationDecisionV3TransitionPreparation` currently invokes semantic
validation and refuses invalid decisions. An action/next-action mismatch has
already failed by that point. Transition-prep is therefore too late and must
remain a non-mutating proposal builder.

### Why not mutate inside the semantic validator?

`validateConversationDecisionV3Semantics` is an assertion boundary. Making it
rewrite decisions would mix enforcement with mutation, hide original model
defects, and make validation results order-dependent. It must remain pure and
fail closed.

### Proposed module

```text
src/intelligence/conversation/ConversationDecisionV3PolicyNormalizer.ts
```

The module will expose a pure function returning a new value plus sanitized
metadata:

```text
normalizeConversationDecisionV3MissingPolicy(decision, modelAdapterInput)
-> {
     decision,
     applied,
     normalization_id,
     reason_codes
   }
```

It is a small V3 boundary helper, not a service, database owner, queue, or new
parallel decision pipeline.

## 2. Runtime Ownership and Coupling

### Responses/V3 only

The canonicalizer will be invoked only by current V3 consumers:

- `src/intelligence/conversation/ConversationDecisionEngine.ts`, only inside
  the `provider === "openai_responses"` branch;
- `src/modelAdapter/responsesGoldenReplay.ts`;
- `src/modelAdapter/responsesShadowService.ts`.

All three call sites must use the same pure function so golden, shadow, and
candidate canary cannot evaluate different action tuples.

### Explicitly unchanged shared/live files

```text
src/intelligence/conversation/AllowedActionResolver.ts
src/intelligence/conversation/ConversationDecisionSchema.ts
src/modelAdapter/AssistantAdapter.ts
src/openaiAssistantClient.ts
```

The existing Assistants/V2 path does not parse `ConversationDecisionV3`, does
not call the proposed canonicalizer, and therefore receives no behavior change.

Package 12C may read the existing unapproved-app deny vocabulary as evidence,
but it must not modify that vocabulary or the candidate intake state machine.
Importing a constant is not permission to alter shared resolver behavior.

### Coupling acceptance rule

Implementation is rejected if any Package 12C production diff changes
`AllowedActionResolver.ts`, changes Assistant adapter selection, or invokes the
canonicalizer outside an `openai_responses` V3 branch.

## 3. Backend-Owned Trigger

The normalizer must not trust model intent or model self-report. It applies only
when all of these backend-derived conditions are true:

1. sender role is `candidate`;
2. channel is `private`;
3. backend inferred intent is `app_fact_question` or
   `app_selection_question`;
4. latest message contains an exact deny-vocabulary app/platform term;
5. that term is not present in `allowed_apps`;
6. no matching approved structured app fact resolves the question;
7. state patch is left untouched for later validation;
8. feature flag `RESPONSES_MISSING_POLICY_NORMALIZATION_ENABLED=true` is
   explicitly set.

If any condition is absent or ambiguous, the function returns the original
decision unchanged and existing validators decide its fate.

The trigger is computed from `ModelAdapterInput` and backend context, not from
`decision.intent`, `quality_signals`, or `self_check`.

## 4. Deterministic Action Precedence

For a matched trigger, the backend owns the control tuple. It does not trust the
model's selected action variant.

Precedence is derived solely from existing `allowed_actions`:

### A. Candidate can be asked for the approved app

When `ask_selected_app` is allowed:

```json
{
  "chosen_actions": ["ask_selected_app"],
  "next_action": "ask_missing_info",
  "requires_escalation": false,
  "escalation_reason": null
}
```

### B. Missing policy can be escalated

When `ask_selected_app` is not allowed and `escalate_policy_missing` is allowed:

```json
{
  "chosen_actions": ["escalate_policy_missing"],
  "next_action": "escalate_missing_info",
  "requires_escalation": true,
  "escalation_reason": "missing_verified_app_policy_fact"
}
```

### C. Only neutral clarification is available

When neither action above is allowed but `clarify_ambiguous_input` is allowed:

```json
{
  "chosen_actions": ["clarify_ambiguous_input"],
  "next_action": "reply_only",
  "requires_escalation": false,
  "escalation_reason": null
}
```

### D. No safe allowed action

No canonicalization is applied. Existing semantic validation rejects or repairs
the model output. The normalizer never invents an action outside
`allowed_actions`.

## 5. What Is and Is Not Normalized

Normalized fields:

- `chosen_actions`;
- `next_action`;
- `requires_escalation`;
- `escalation_reason`.

Never normalized:

- `reply.text`;
- role;
- state patch;
- state patch evidence;
- policy facts used;
- risk flags;
- quality/self-check fields;
- sender, tenant, or channel.

Consequences:

- an unapproved app echoed in the reply still fails `UNAPPROVED_APP_IN_REPLY`;
- a non-null unsupported state patch still fails semantic validation;
- an invented policy fact still fails grounding validation;
- owner/group/spoof/wrong-channel decisions remain untouched and fail closed;
- canonicalization cannot turn unsafe content into a passing decision.

## 6. Historical Variation Coverage

Historical reports preserve sanitized classifications, not every raw provider
JSON. The design therefore must not claim unavailable raw values. It covers the
entire evidenced control-variation class by replacing the four-field control
tuple only after the narrow backend trigger is proven.

| Historical qualification point | Evidence | How the design handles it |
|---|---|---|
| Initial Package 12, `0/3` | Repeated unknown-app missing-policy failure | Backend trigger ignores the varying model control tuple and selects one allowed canonical tuple. Unsafe reply/state/facts still reject. |
| Stage 7, `2/3` | Run 3 had escalation next-action mismatch | `escalate_policy_missing` deterministically pairs with `escalate_missing_info`, escalation=true, and a stable internal reason. |
| Expanded classified, `1/3` | Runs 1 and 3 had semantic action/transition rejection | Any model action tuple is replaced only for the proven missing-policy trigger; semantic validation then evaluates the canonical tuple and untouched content/state. |
| Final combined closure, `3/3` | Model happened to produce valid tuples | Already canonical output is idempotent; normalized result is equivalent and records `applied=false` or `already_canonical`. |
| Package 13 requalification, `2/3` | `ask_missing_info` + `clarify_ambiguous_input` produced `NEXT_ACTION_MISMATCH` | Because escalation is allowed and ask-selected-app is not, the tuple becomes `escalate_policy_missing` + `escalate_missing_info`. |

This approach covers future permutations of those same four control fields. It
does not broadly repair malformed JSON, invalid schema, unsafe replies,
unapproved app echoes, state fabrication, or actions outside a backend-proven
missing-policy trigger.

## 7. Observability

Sanitized trace fields:

```text
missing_policy_normalization_checked
missing_policy_normalization_applied
normalization_id
normalization_reason_codes
original_control_tuple_hash
normalized_control_tuple_hash
semantic_validation_after_normalization
transition_prep_after_normalization
raw_text_logged=false
```

No raw user message, model reply, phone, JID, app token, or policy text is added
to logs.

Golden reports should distinguish:

- model tuple already valid;
- backend tuple normalized;
- normalization not applicable;
- normalized decision rejected later by safety/grounding/state validation.

Normalization must not make a rejected unsafe response appear as a native model
success. Model-origin and normalization-origin metrics remain separate.

## 8. Feature Flag and Rollback

Proposed flag:

```text
RESPONSES_MISSING_POLICY_NORMALIZATION_ENABLED=false
```

Default is false. Qualification explicitly enables it process-locally. No
production or canary activation is implied.

Rollback sequence:

1. set `MODEL_ADAPTER_CANARY_MODE=off` if any canary is active;
2. invalidate the current owner approval;
3. set `RESPONSES_MISSING_POLICY_NORMALIZATION_ENABLED=false`;
4. preserve sanitized observations and normalization counters;
5. run build, full tests, no-outbound acceptance, and provenance verification;
6. require fresh qualification and a fresh owner approval before re-arm.

No DB rollback, state migration, vector change, Assistant binding change, or
Evolution change is required.

## 9. Planned Files

Expected production changes, subject to owner approval:

```text
src/intelligence/conversation/ConversationDecisionV3PolicyNormalizer.ts  (new)
src/intelligence/conversation/ConversationDecisionEngine.ts
src/modelAdapter/responsesGoldenReplay.ts
src/modelAdapter/responsesShadowService.ts
src/config/env.ts
src/server.ts or the existing model-execution config wiring only if required
```

Expected tests:

```text
src/tests/conversationDecisionV3PolicyNormalizer.test.ts                 (new)
src/tests/conversationDecisionV3SemanticValidator.test.ts
src/tests/conversationDecisionV3TransitionPreparation.test.ts
src/tests/modelAdapter/responsesGoldenReplay.test.ts
src/tests/modelAdapter/responsesShadowService.test.ts
src/tests/modelAdapter/package13CandidateCanary.test.ts
src/tests/modelAdapter/assistantAdapter.contract.test.ts
```

`AllowedActionResolver.ts` is explicitly outside the planned diff.

## 10. Test Strategy

### A. Table-driven normalizer tests

At minimum:

1. canonical escalation remains canonical;
2. `ask_missing_info + clarify_ambiguous_input` becomes escalation tuple;
3. handoff/reply-only variants become the same escalation tuple when escalation
   is the highest allowed action;
4. `ask_selected_app` takes precedence only when already allowed;
5. clarification fallback is used only when ask/escalate are unavailable;
6. unsafe reply remains unsafe after tuple normalization;
7. non-null patch remains rejected;
8. invented policy fact remains rejected;
9. owner, manager, group, approved-app, payment, trust, and prompt-injection
   inputs are unchanged;
10. flag off returns byte-equivalent decision content.

### B. Shared-path regression

- `AllowedActionResolver` behavior snapshot remains unchanged.
- Assistant adapter contract fixtures remain unchanged.
- Assistant provider branch never imports or calls the V3 normalizer.
- Responses provider, golden replay, and shadow observation use the same helper.

### C. Combined real-model regression

Command remains:

```powershell
$env:RESPONSES_QUALIFICATION_REAL='true'
$env:RESPONSES_MISSING_POLICY_NORMALIZATION_ENABLED='true'
$env:OPENAI_RESPONSES_MODEL='<configured-model>'
npm.cmd run test:package12:combined-real
```

All memberships are evaluated from the same 23 unique model outputs in each
run. Targeted scenarios overlap expanded scenarios; the system must not make 26
separate calls.

Required for each of three runs:

```text
baseline: >=12/13
targeted: 3/3
expanded: >=9/10
unsafe claims: 0
real outbound: 0
```

The report must separately show how many decisions were model-native versus
backend-normalized. A scenario passes only after shape, canonicalization,
semantic validation, transition preparation, deterministic quality checks, and
forbidden-content checks all pass.

### D. Full acceptance

- targeted unit/contract tests pass;
- full build and full suite pass;
- `npm audit --omit=dev` remains clean;
- source provenance verifies;
- exact immutable image full tests pass with network disabled;
- exact-image no-outbound/startup acceptance passes;
- secret/PII scan passes;
- canary remains unarmed until separate owner approval.

## 11. Acceptance Criteria

Package 12C implementation may be accepted only if:

1. the canonicalizer is V3/Responses-only;
2. `AllowedActionResolver.ts` has no diff;
3. Assistants/V2 contract and routing remain unchanged;
4. all historical action-tuple variants map deterministically under the narrow
   backend trigger;
5. unsafe reply, state, and grounding failures remain rejected;
6. combined three-run targets pass simultaneously;
7. no aggregate threshold relaxation is introduced;
8. no real outbound occurs;
9. rollback is flag-off and requires fresh qualification/approval;
10. no deploy or arming occurs without a separate owner instruction.

## 12. Design Decision Summary

```text
NORMALIZATION_LAYER=V3_POST_SHAPE_PRE_SEMANTIC
NEW_SERVICE_CREATED=NO
TRANSITION_PREP_MUTATES_DECISION=NO
SEMANTIC_VALIDATOR_MUTATES_DECISION=NO
RESPONSES_V3_ONLY=YES
ALLOWED_ACTION_RESOLVER_SHARED_CHANGE=NO
ASSISTANTS_PATH_CHANGED=NO
STATISTICAL_TOLERANCE_ADOPTED=NO
PROMPT_ONLY_FIX=NO
CANARY_ARMED=NO
IMPLEMENTATION_REQUIRES_OWNER_APPROVAL=YES
```
