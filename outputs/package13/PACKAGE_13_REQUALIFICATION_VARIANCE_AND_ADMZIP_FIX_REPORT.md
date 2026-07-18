# Package 13 Requalification Variance and adm-zip Fix

Date: 2026-07-18  
Canary armed: **NO**  
Deploy executed: **NO**

## 1. `p12_unknown_app_missing_info` Classification

Decision: **PRE-EXISTING INTERMITTENT MODEL ACTION-CONSISTENCY FAILURE**.

This is not a new Package 13 regression.

### Historical evidence

| Qualification point | Scenario result |
|---|---|
| Initial Package 12 expanded run | Failed in runs 1, 2, and 3 |
| Package 12B Stage 7 isolated app replay | Passed runs 1 and 2; failed run 3 |
| Expanded classified replay | Failed runs 1 and 3; passed run 2 |
| Package 12B final combined closure | Passed runs 1, 2, and 3 |
| Package 13 requalification | Passed runs 1 and 2; failed run 3 |

Evidence files:

- `outputs/package12/PACKAGE_12_REAL_MODEL_QUALIFICATION_REPORT.md`
- `outputs/package12/PACKAGE_12B_STAGE7_APP_ALLOWLIST_CONTRACT_REPORT.md`
- `outputs/package12/PACKAGE_12_EXPANDED_CLASSIFIED_REPLAY_AND_ROLLBACK_DESIGN_REPORT.md`
- `outputs/package12/PACKAGE_12B_COMBINED_REGRESSION_CLOSURE_REPORT.md`
- `outputs/package13/PACKAGE_13_ARMING_BLOCKER_CLOSURE_REPORT.md`

The historical final combined closure's 3/3 was one clean batch, not evidence
that the scenario had always been deterministic. Earlier real-model evidence
already showed both 1/3 and 2/3 pass patterns.

### Package 13 isolation

Command:

```text
git diff --name-status d78e157..fa5e2df
git diff --stat d78e157..fa5e2df -- \
  scripts/responsesQualificationSuite.ts \
  src/modelAdapter/ResponsesAdapter.ts \
  src/modelAdapter/responsesGoldenReplay.ts \
  src/modelAdapter/responsesDecisionPrompt.ts \
  src/conversationDecisionV3*
```

Result:

```text
QUALIFICATION_PATH_DIFF=EMPTY
PACKAGE_LOCK_DIFF_BEFORE_ADM_ZIP_FIX=EMPTY
```

Package 13 changed owner approval, canary reservation/stop persistence,
Connection Doctor projection, and their tests. It did not change:

- the combined qualification runner;
- the Responses adapter;
- the decision prompt;
- the scenario definition or expected action;
- transition preparation;
- semantic/quality validation;
- the model name used by qualification.

Therefore intent/traffic scoping and terminal egress persistence cannot explain
the changed model output. The current failure is the same pre-existing action
variance: `ask_missing_info` with `clarify_ambiguous_input` fails the scenario's
required action/next-action consistency.

## 2. Threshold Recommendation

Recommendation: **do not silently replace per-run targeted 3/3 with aggregate
8/9 after observing a failure**.

Reasons:

1. This is an action/transition consistency assertion, not a harmless wording
   preference.
2. A favorable 3/3 batch has already been followed by a 2/3 batch, so one clean
   qualification does not establish stability.
3. Aggregate 8/9 would allow the exact known contract mismatch to recur in
   production qualification while still declaring success.
4. Changing the gate after it fails would weaken the pre-agreed acceptance
   contract and make historical comparisons ambiguous.

Preferred closure is deterministic backend normalization or constrained action
selection for semantically equivalent missing-policy outcomes, rather than
another broad prompt patch. A prompt-only tightening may reduce frequency but
cannot guarantee action consistency. Any such change must rerun the combined
23-scenario, three-run procedure and preserve zero unsafe claims.

The candidate greeting/first-contact canary does not include unknown-app intent,
but the currently accepted Package 12 gate still requires targeted 3/3. No scope
exception or threshold change was implemented in this task.

```text
STATISTICAL_TOLERANCE_ADOPTED=NO
PROMPT_CHANGED=NO
ACTION_NORMALIZATION_CHANGED=NO
PACKAGE_12_GATE_CHANGED=NO
CANARY_ARMED=NO
```

## 3. `adm-zip` Security Fix

Before:

```text
adm-zip=0.5.18
npm audit --omit=dev: high=1, critical=0
audit fix target=0.6.0
```

Applied:

```text
npm.cmd install adm-zip@0.6.0 --save-exact
```

Changed files:

- `package.json`
- `package-lock.json`

After:

```text
npm audit --omit=dev
total=0
high=0
critical=0
```

### Verification

Targeted ZIP, ingestion, source-integrity, publish, and visual-research tests:

```text
Test Files  6 passed (6)
Tests       50 passed (50)
```

Build and full suite:

```text
npm.cmd run build
WORKSPACE_PREFLIGHT=PASS
tsc -p tsconfig.json

npm.cmd test -- --run
Test Files  83 passed (83)
Tests       545 passed (545)
```

Updated provenance:

```text
source_tree_hash=4cf2079a188bc93592ac52a45bba332ff90b1d9ce515025bf8845fc04e0bc8cc
package_lock_hash=39fbd255187c77d3792ea921680c7bdcf72e648a88abee89b298167937bcb1c8
manifest_hash=d344b6951200c3c88527fdbd88b42346ecd4b7dd963d9a22bdee098ed5602833
PROVENANCE_VERIFIED=YES
```

Updated immutable image:

```text
tag=now-os-canary-prep:4cf2079a188b
image_id=sha256:052489284965abf0c1035818caadac2a48f167448bddab838be5fce9d23af20c
SOURCE_LABEL_MATCH=true
network_disabled_full_tests=545/545 PASS
isolated_health=200
outbound_send_evidence_count=0
```

## Final Decision

```text
SCENARIO_CLASSIFICATION=PRE_EXISTING_INTERMITTENT
PACKAGE_13_CAUSED_REGRESSION=NO
ADM_ZIP_SECURITY_FIX=PASS
RUNTIME_VULNERABILITIES=0
PACKAGE_12_REQUALIFICATION=NOT_ELIGIBLE
CANARY_ARMED=NO
DEPLOY_EXECUTED=NO
REMAINING_BLOCKER=p12_unknown_app_missing_info deterministic action consistency
```
