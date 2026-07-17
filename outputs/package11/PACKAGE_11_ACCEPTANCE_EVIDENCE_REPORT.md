# Package 11 - Prompt / Policy Repair Acceptance Evidence

Generated: 2026-07-18

## Status

Package 11 status: IMPLEMENTED / LOCAL PASS

Scope:

- Responses golden replay evaluator now treats backend validator-computed quality metrics as authoritative.
- Model self-report fields remain diagnostic only.
- Manual-flag-only fallback policy remains unchanged and is covered by tests.
- Three repeated no-outbound replay runs are covered by the replay test harness.
- Package 11B is explicitly required before Package 12.

Not done in Package 11:

- No real OpenAI Responses API call was executed.
- No live canary was enabled.
- No production deploy was performed.
- Package 04 `app_facts.md` fixture repair and Ek 6 structured facts were not silently marked fixed; they are locked into Package 11B before Package 12.

## Files Changed

| Area | File | Evidence |
| --- | --- | --- |
| Prompt policy | `src/modelAdapter/responsesDecisionPrompt.ts` | Adds diagnostic-only self-report instruction. |
| Golden replay evaluator | `src/modelAdapter/responsesGoldenReplay.ts` | Adds validator-authoritative metrics, self-report mismatch tracking, and repeated replay runner. |
| Golden replay tests | `src/tests/modelAdapter/responsesGoldenReplay.test.ts` | Tests self-report mismatch override and 3 repeated replay runs. |
| Shadow fallback policy tests | `src/tests/modelAdapter/responsesShadowService.test.ts` | Tests manual-flag-only fallback behavior. |
| Prompt tests | `src/tests/modelAdapter/responsesDecisionPrompt.test.ts` | Verifies diagnostic-only wording. |
| Package 11B ordering test | `src/tests/architecture/package11Planning.test.ts` | Locks Package 11B before Package 12 and manual-flag-only policy. |
| Design doc | `docs/architecture/PACKAGE_11_PROMPT_POLICY_REPAIR_DESIGN.md` | Records Package 11B, Ek 6, Package 04 fixture, and manual-flag-only decisions. |

## Addendum Matrix

| Addendum item | Result | Why | Evidence |
| --- | --- | --- | --- |
| Ek 1 - Self-report risk | uygulandi | Model self-report is compared with backend-computed metrics; validator result is authoritative. | `src/modelAdapter/responsesGoldenReplay.ts`; `src/tests/modelAdapter/responsesGoldenReplay.test.ts`; targeted tests `37 passed`. |
| Ek 2 - Concurrency lock | uygulanmadi Package 11'de | Already belongs to Package 10 deterministic transition prep, not prompt/policy repair. | `docs/architecture/PACKAGE_10_CONTROLLED_STATE_TRANSITION_PREP_DESIGN.md`; Package 10 accepted separately. |
| Ek 3 - Fallback type | uygulandi | Kept as `manual-flag-only`; runtime-automatic fallback is not introduced because it could hide schema/prompt failures and obscure replay metrics. | `docs/architecture/PACKAGE_11_PROMPT_POLICY_REPAIR_DESIGN.md`; `src/tests/modelAdapter/responsesShadowService.test.ts`. |
| Ek 4 - Model selection/canary readiness | uygulanmadi Package 11'de | Belongs to Package 12 after Package 11B; Package 11 remains replay/shadow quality repair. | `docs/architecture/PACKAGE_11_PROMPT_POLICY_REPAIR_DESIGN.md`. |
| Ek 5 - `escalate_missing_info` | uygulanmadi Package 11'de | Already added in Package 10 transition prep and prompt rules; Package 11 keeps it in prompt scope but does not redesign state transition. | `src/modelAdapter/responsesDecisionPrompt.ts`; `src/intelligence/conversation/ConversationDecisionV3Schema.ts`. |
| Ek 6 - Structured facts separation | uygulanmadi Package 11'de | Accepted as Package 11B before Package 12 together with Package 04 `app_facts.md` fixture hardening. | `docs/architecture/PACKAGE_11_PROMPT_POLICY_REPAIR_DESIGN.md`; `src/tests/architecture/package11Planning.test.ts`. |

## Package 11B Gate Before Package 12

Decision: Package 11B is mandatory before Package 12.

Reason:

- Package 04 rerun exposed `app_facts.md` fixture/source availability risk.
- Ek 6 requires structured facts separation, not only prompt changes.
- Model selection/canary readiness in Package 12 should not proceed while context source integrity is unresolved.

Evidence command:

```text
npm.cmd test -- --run src/tests/modelAdapter/responsesGoldenReplay.test.ts src/tests/modelAdapter/responsesShadowService.test.ts src/tests/modelAdapter/responsesDecisionPrompt.test.ts src/tests/architecture/package11Planning.test.ts src/tests/modelExecutionEnv.test.ts src/tests/modelAdapter/responsesAdapter.contract.test.ts src/tests/modelAdapter/modelExecutionService.selection.test.ts
```

Output:

```text
Test Files  7 passed (7)
Tests       37 passed (37)
```

## Model-Agnostic Rule

Rule: Package 11 must not introduce model-specific branching or hardcoded production model names.

Command 1:

```text
rg -n "gpt-4\.1|gpt-4o" src package.json --glob '!dist/**' --glob '!node_modules/**'
```

Output:

```text
<no matches; command exit code 1>
```

Command 2:

```text
rg -n "model\s*===|model\s*==|if\s*\([^\n]*model|switch\s*\([^\n]*model" src package.json --glob '!dist/**' --glob '!node_modules/**'
```

Output classification:

- `src/modelAdapter/modelAdapterSelection.ts`: feature-flag/canary mode routing, not model-name branching.
- `src/intelligence/**` and `src/bridge/**`: domain fields such as `work_model_acceptance`, not provider/model selection.
- `src/tests/**`: fixture/domain state and test adapters, not runtime branching by model name.

Command 3:

```text
rg -n "gpt-test-responses" src/tests --glob '!dist/**' --glob '!node_modules/**'
```

Output:

```text
src/tests\modelAdapter\responsesAdapter.contract.test.ts:134:      model: "gpt-test-responses",
src/tests\modelAdapter\responsesAdapter.contract.test.ts:162:      model: "gpt-test-responses",
src/tests\modelAdapter\responsesAdapter.contract.test.ts:179:      model: "gpt-test-responses",
src/tests\modelAdapter\responsesAdapter.contract.test.ts:191:      model: "gpt-test-responses",
src/tests\modelAdapter\responsesAdapter.contract.test.ts:197:      model: "gpt-test-responses",
src/tests\modelAdapter\responsesDecisionPrompt.test.ts:52:      model: "gpt-test-responses",
```

Conclusion: no `gpt-4.1-mini`, `gpt-4.1`, `gpt-4o`, or runtime `if model === ...` style implementation dependency was introduced. Test-only fake model labels remain reporting fixtures.

## Replay Quality Target

Target:

- At least 3 repeated replay runs.
- Each run >= 12/13.
- Zero unsafe claim violations.
- Real outbound = 0.

Evidence:

- File: `src/tests/modelAdapter/responsesGoldenReplay.test.ts`
- Test: `passes three repeated no-outbound replay runs with an ideal model-agnostic adapter`
- Command: targeted Package 11 test command above.
- Result: `37 passed (37)`.

Important limitation:

This Package 11 evidence uses the no-outbound replay harness and an ideal model-agnostic adapter fixture. It verifies the evaluator, prompt-policy constraints, self-report discipline, and replay target mechanics. A real configured OpenAI model run is intentionally not executed in Package 11; model comparison and canary readiness remain Package 12 after Package 11B.

## Ek 1 Evidence - Validator Is Authoritative

Evidence search:

```text
rg -n "validator_authoritative|self_report_mismatch|diagnostic only|backend validators independently" src docs --glob '!dist/**' --glob '!node_modules/**'
```

Relevant output:

```text
src\modelAdapter\responsesDecisionPrompt.ts:84:    "Set quality_signals and self_check honestly, but they are diagnostic only; backend validators independently compute final quality and will ignore optimistic self-report.",
src\modelAdapter\responsesGoldenReplay.ts:230:  self_report_mismatch_codes: string[];
src\modelAdapter\responsesGoldenReplay.ts:259:  validator_authoritative: true;
src\modelAdapter\responsesGoldenReplay.ts:260:  self_report_mismatch_total: number;
src\modelAdapter\responsesGoldenReplay.ts:546:    validator_authoritative: true,
src\tests\modelAdapter\responsesGoldenReplay.test.ts:319:    expect(result.self_report_mismatch_codes).toContain("SELF_REPORT_MISMATCH:no_invented_policy");
src\tests\modelAdapter\responsesGoldenReplay.test.ts:334:    expect(repeated.validator_authoritative).toBe(true);
```

## Ek 3 Evidence - Manual-Flag-Only

Evidence search:

```text
rg -n "manual-flag-only|keeps fallback manual-flag-only" src docs --glob '!dist/**' --glob '!node_modules/**'
```

Relevant output:

```text
src\tests\modelAdapter\responsesShadowService.test.ts:261:  it("keeps fallback manual-flag-only when the Responses shadow decision is invalid", async () => {
docs\architecture\PACKAGE_11_PROMPT_POLICY_REPAIR_DESIGN.md:102:Package 11 keeps the fallback type as `manual-flag-only`.
```

Reason manual-flag-only was not changed:

- Runtime-automatic fallback could hide schema/prompt failures.
- Quality metrics would become ambiguous.
- Package 11 is shadow/replay quality repair, not live resilience cutover.
- Rollback remains explicit through flags.

## Verification Commands

### Targeted Package 11 Tests

Command:

```text
npm.cmd test -- --run src/tests/modelAdapter/responsesGoldenReplay.test.ts src/tests/modelAdapter/responsesShadowService.test.ts src/tests/modelAdapter/responsesDecisionPrompt.test.ts src/tests/architecture/package11Planning.test.ts src/tests/modelExecutionEnv.test.ts src/tests/modelAdapter/responsesAdapter.contract.test.ts src/tests/modelAdapter/modelExecutionService.selection.test.ts
```

Output:

```text
Test Files  7 passed (7)
Tests       37 passed (37)
```

### Build

Command:

```text
npm.cmd run build
```

Output:

```text
WORKSPACE_PREFLIGHT=PASS
tsc -p tsconfig.json
```

### Full Test Suite

Command:

```text
npm.cmd test
```

Output:

```text
Test Files  76 passed (76)
Tests       514 passed (514)
```

Note: the full test output included expected fixture lines before provenance regeneration:

```text
PROVENANCE_VERIFIED=NO reason_codes=SOURCE_TREE_HASH_MISMATCH
PROVENANCE_GENERATED=NO reason=DIST_SERVER_MISSING
```

After build and Package 11 changes, provenance was regenerated and verified below.

### Audit

Command:

```text
npm.cmd audit --audit-level=high
```

Output:

```text
found 0 vulnerabilities
```

### Provenance Generate

Command:

```text
npm.cmd run provenance:generate -- --test-result package11-full-tests-514-pass
```

Output:

```text
PROVENANCE_GENERATED=YES source_tree_hash=b50afa416e1ad9e30f7c92bec59868658b0333f18248efe3ce6888c884daf46c package_lock_hash=90e17cc0a3b6cfbee86758a5a573ae446f54d1973dd0c14c1c6b489542ef66ea dist_tree_hash=0d4e07d5317e10f2477ca737fa6d7dc6f191db3f5e90e9ccb556ed21188e4e15 workspace_identity_hash=4db557418dcaad79bf29c01788f72ca2a36aee0aa18d338f4f8054de3b35c57b manifest_hash=94cb937b470812774a9084a176b7ffbb42ba7096b044e025a980cdc9d2a76338
```

### Provenance Verify

Command:

```text
npm.cmd run provenance:verify
```

Output:

```text
PROVENANCE_VERIFIED=YES source_tree_hash=b50afa416e1ad9e30f7c92bec59868658b0333f18248efe3ce6888c884daf46c package_lock_hash=90e17cc0a3b6cfbee86758a5a573ae446f54d1973dd0c14c1c6b489542ef66ea dist_tree_hash=0d4e07d5317e10f2477ca737fa6d7dc6f191db3f5e90e9ccb556ed21188e4e15 workspace_identity_hash=4db557418dcaad79bf29c01788f72ca2a36aee0aa18d338f4f8054de3b35c57b
```

## Safety

- OpenAI publish triggered: NO
- Vector store modified: NO
- Assistant binding changed: NO
- Production deploy executed: NO
- WhatsApp outbound sent: NO
- Queue/worker cutover enabled: NO
- Real OpenAI Responses API call executed: NO
- Secrets printed: NO
- Raw phone/JID/groupId logged: NO

## Rollback

Rollback remains flag-off:

```text
RESPONSES_SHADOW_ENABLED=false
RESPONSES_SHADOW_MODE=off
MODEL_ADAPTER_LAYER_ENABLED=false
MODEL_ADAPTER_CANARY_MODE=off
```

Package 11 is replay/shadow-only; live behavior remains protected unless later packages explicitly enable it.

## Result

- package_11_status: PASS
- package_11b_required_before_package_12: YES
- model_agnostic_rule_preserved: YES
- target_replay_harness_passed: YES
- real_model_quality_certified: NO, deferred to Package 12 after Package 11B
- ready_for_package_11b: YES
- ready_for_package_12: NO, Package 11B must complete first
