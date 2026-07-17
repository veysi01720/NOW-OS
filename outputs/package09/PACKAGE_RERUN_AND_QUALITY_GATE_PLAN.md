# Package Rerun And Quality Gate Plan

Generated: 2026-07-17

## 1. Git Repository

- Git initialized: YES
- Workspace:

```text
C:\Users\lll\Documents\Codex\2026-07-04\i\work\package09_semantic_enforcement
```

- Initial commit:

```text
28f4935 chore: establish package 09 baseline
```

- Note: this starts real local Git history from Package 09 onward. Previous package timestamps cannot be reconstructed from Git because this workspace was not a Git repository before this point.

## 2. Package 06 Quality Gate Blockage

Package 06 measured real model replay quality and blocked cutover.

Evidence file:

```text
C:\Users\lll\Documents\Codex\2026-07-04\i\work\package06_golden_replay\outputs\package06\PACKAGE_06_GOLDEN_REPLAY_ACCEPTANCE.md
```

Package 06 result:

```text
gpt-4.1-mini: 6/13 PASS, 7 FAIL, pass rate 46.15%
gpt-4.1:      11/13 PASS, 2 FAIL, pass rate 84.62%
Responses quality gate: BLOCKED
```

## 3. Which Packages Resolve The Quality Gate

### Package 09 - Backend Semantic Enforcement

- Status: DONE.
- Purpose: make invalid model decisions fail closed before any future state or egress use.
- Solves: strict schema success being mistaken for safe behavior.
- Does not solve alone: model quality/pass-rate.

### Package 10 - Controlled State-Transition Preparation

- Planned.
- Purpose: accepted semantic V3 decisions may be converted into non-mutating transition proposals.
- Required effect: compact intake and text-only decisions must be evaluated against deterministic backend transition rules.
- Expected improvement target: remove state-patch mismatch failures from golden replay.

### Package 11 - Prompt / Decision Policy Repair And Multi-Seed Replay

- Planned.
- Purpose: revise Responses decision prompt and evaluator examples after Package 09/10 enforcement is in place.
- Required effect: reduce unsupported handoff, forbidden app mention, and action namespace confusion.
- Target for `gpt-4.1-mini`: at least `12/13` per run, `>= 92.3%`, across at least 3 repeated runs, with:
  - unsafe claim count = 0
  - unapproved app mention = 0
  - action allowlist violations = 0
  - state patch mismatch = 0
  - real outbound = 0

### Package 12 - No-Outbound Shadow Acceptance / Model Selection

- Planned if Package 11 passes locally.
- Purpose: compare `gpt-4.1-mini` and stronger model candidate under the same semantic validator and transition-prep gates.
- Decision rule:
  - If `gpt-4.1-mini` does not reach the target, it remains disqualified for live canary.
  - If `gpt-4.1` reaches `13/13` or stable `>=12/13` with zero unsafe findings, it becomes the preferred candidate for shadow/canary.

## 4. Rerun Results

### Package 1 / 2 / 3

No standalone historical package workspaces were available for Package 1, 2, or 3. I therefore ran the current canonical source root as the closest executable re-run. This is not a Git-historical package-specific re-run.

Workspace:

```text
C:\Users\lll\Documents\Codex\2026-07-04\i
```

Build:

```text
npm.cmd run build
WORKSPACE_PREFLIGHT=PASS
tsc -p tsconfig.json
exit code 0
```

Tests:

```text
npm.cmd test
Test Files  61 passed (61)
Tests       424 passed (424)
```

### Package 04

Workspace:

```text
C:\Users\lll\Documents\Codex\2026-07-04\i\work\package04_adapter_contract
```

Build:

```text
npm.cmd run build
WORKSPACE_PREFLIGHT=PASS
tsc -p tsconfig.json
exit code 0
```

Tests:

```text
npm.cmd test
Test Files  1 failed | 66 passed (67)
Tests       1 failed | 452 passed (453)
```

Failure:

```text
src/tests/reviewRoutes.test.ts > Phase 3B review routes > approves candidates without publishing, vector changes, or active knowledge writes
Error: ENOENT: no such file or directory, open '...\work\package04_adapter_contract\data\knowledge_bank\app_facts.md'
```

Conclusion: Package 04 build passes, but today's re-run test does not pass because the historical workspace is missing a data fixture expected by a later review-route test.

### Package 04B

Workspace:

```text
C:\Users\lll\Documents\Codex\2026-07-04\i\work\package04b_migration_hardening
```

Build:

```text
npm.cmd run build
WORKSPACE_PREFLIGHT=PASS
tsc -p tsconfig.json
exit code 0
```

Tests:

```text
npm.cmd test
Test Files  68 passed (68)
Tests       463 passed (463)
```

### Package 06

Workspace:

```text
C:\Users\lll\Documents\Codex\2026-07-04\i\work\package06_golden_replay
```

Build:

```text
npm.cmd run build
WORKSPACE_PREFLIGHT=PASS
tsc -p tsconfig.json
exit code 0
```

Tests:

```text
npm.cmd test
Test Files  71 passed (71)
Tests       480 passed (480)
```

### Package 07

Workspace:

```text
C:\Users\lll\Documents\Codex\2026-07-04\i\work\package07_reconciliation
```

Build:

```text
npm.cmd run build
WORKSPACE_PREFLIGHT=PASS
tsc -p tsconfig.json
exit code 0
```

Tests:

```text
npm.cmd test
Test Files  72 passed (72)
Tests       485 passed (485)
```

## 5. Decision

- Git history is now active from Package 09 onward.
- Package 04 today's historical workspace re-run is not green due missing fixture file.
- Package 04B, Package 06, Package 07 re-runs are green.
- Package 1/2/3 package-specific re-runs could not be performed because no standalone historical workspaces are present; current canonical source root build/test is green.
- Package 06 quality gate will be addressed by Package 10, 11, and 12, not by relaxing thresholds.

## 6. Addendum Intake Before Package 10

Source addendum:

```text
C:\Users\lll\Downloads\now-os-responses-migration-addendum.md
```

Package 10 design document:

```text
C:\Users\lll\Documents\Codex\2026-07-04\i\work\package09_semantic_enforcement\docs\architecture\PACKAGE_10_CONTROLLED_STATE_TRANSITION_PREP_DESIGN.md
```

Decisions:

- Ek 5 (`escalate_missing_info`) is included in Package 10 scope because it is a deterministic missing-info transition proposal concern.
- Ek 2 (candidate-based concurrency lock) is included in Package 10 scope as a minimal candidate-scoped transition evaluation lock, not as queue/worker cutover.
- Ek 6 (structured facts separation) is likely related to the Package 04 `app_facts.md` fixture failure at the architecture level. The immediate failure is a missing fixture/path issue; the deeper fix is structured, testable facts before later replay/cutover decisions.
- Ek 1 is placed into Package 11/12 replay evaluation: validator-computed metrics must be authoritative over model self-report.
- Ek 3 is placed into Package 11/12 adapter fallback documentation and tests.
- Ek 4 is placed into Package 12 shadow/canary readiness after enough replay metrics exist.

Package 10 acceptance report must include every addendum item in `uygulandi` /
`uygulanmadi` / `sonraki_pakete_ertelendi` format with evidence and reason.
