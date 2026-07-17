# Package 10 - Controlled State-Transition Preparation Design

Generated: 2026-07-17

## Status

Design prepared before implementation. Package 10 has not started.

## Purpose

Package 10 prepares a backend-owned, non-mutating transition layer for accepted
Conversation Decision V3 outputs. It must not write production state, send
WhatsApp messages, enable canary, or activate Responses for live traffic.

The package exists to prove that model decisions can be interpreted by
deterministic backend rules before any later shadow/canary path is allowed.

## Non-Negotiables

- No production deploy.
- No real WhatsApp outbound.
- No queue/worker cutover.
- No broad guard-pipeline refactor.
- No JSON store migration or destructive data changes.
- No direct model patch merge into persistent state.
- Backend owns transition validation and transition proposal preparation.
- Model output remains advisory until deterministic backend checks pass.

## Package 10 Scope

### 1. Non-Mutating Transition Proposal

Accepted semantic V3 decisions may be converted into a transition proposal.
The proposal is an evaluation artifact, not a persistent state write.

The proposal should include:

- candidate key, masked or synthetic in tests;
- current state snapshot summary;
- accepted model intent and action;
- deterministic transition candidate;
- missing fields before and after;
- transition validity;
- rejection reason when invalid;
- no persistence side effect.

### 2. Deterministic Backend Transition Rules

Package 10 must evaluate at least these transition categories:

- first contact / greeting;
- compact intake such as age + gender + daily hours in one message;
- selected app capture only from approved app values;
- phone type capture;
- text-only preference capture;
- support / confusion signal;
- missing information escalation.

### 3. Addendum Ek 5 - `escalate_missing_info`

Decision: include in Package 10 design and implementation scope.

Reason: this is organic to deterministic backend transition rules. It gives the
model a narrow, explicit action when relevant knowledge or candidate data is
missing, instead of inventing facts or falling into a generic safe fallback.

Package 10 handling:

- V3 transition preparation must recognize `escalate_missing_info` as a valid
  advisory action when the backend context lacks required information.
- The backend must map it to a non-mutating missing-info transition proposal.
- The proposal must not send an internal note to the user.
- Acceptance tests must include at least one missing-info fixture where the
  expected outcome is escalation, not invented advice.

Important boundary: if the V3 schema enum itself is changed in a later schema
file, the transition-prep code must still fail closed until schema, parser, and
validator all agree on the new value.

### 4. Addendum Ek 2 - Candidate-Based Concurrency Lock

Decision: include in Package 10 design as a minimal candidate-scoped lock
preparation, without queue/worker cutover.

Reason: rapid WhatsApp messages from the same candidate can otherwise evaluate
against the same stale state and produce conflicting proposals. This is not a
full queue system; it is a narrow synchronization guard around transition
evaluation.

Package 10 handling:

- Introduce or prepare a candidate-id scoped in-memory mutex for transition
  evaluation tests.
- The second event for the same candidate must wait or be rejected with a
  deterministic test-only reason until the first evaluation completes.
- Different candidate keys must not block each other.
- No queue table, worker process, or production fast-ACK cutover is allowed.
- Acceptance tests must prove duplicate/conflicting state proposals are not
  produced for two near-simultaneous messages from the same candidate.

### 5. Package 10 Acceptance Matrix For Addendum Items

The Package 10 acceptance report must include this table and fill each result
as `uygulandi`, `uygulanmadi`, or `sonraki_pakete_ertelendi`.

| Addendum Item | Package 10 Result | Why | Evidence |
|---|---|---|---|
| Ek 1 - self-report risk | TBD | Validator-computed quality metrics belong primarily to Package 11/12 replay evaluation, not transition preparation unless touched by tests. | File path / test command |
| Ek 2 - candidate concurrency lock | TBD | Package 10 scope includes minimal candidate-scoped transition evaluation lock, not queue cutover. | File path / test command |
| Ek 3 - Assistants fallback type | TBD | Belongs to Package 11/12 adapter selection and cutover docs, not state-transition prep. | File path / test command |
| Ek 4 - numeric rollback thresholds | TBD | Belongs to Package 12 shadow/canary readiness after replay metrics exist. | File path / test command |
| Ek 5 - escalate_missing_info | TBD | Package 10 scope includes missing-info transition proposal handling. | File path / test command |
| Ek 6 - structured facts split | TBD | Package 10 may document dependency, but implementation belongs with context/knowledge fixture hardening before Package 11/12 replay. | File path / test command |

## Addendum Placement Outside Package 10

### Ek 1 - Self-Report / Quality Signals

Placement: Package 11 and Package 12.

Rationale: Package 09 already added backend semantic enforcement. Package 11/12
must not trust model self-reported quality booleans. Replay success must be
computed by deterministic validators.

Required later evidence:

- validator-computed metrics compared against model self-report fields;
- self-report mismatch does not mark a scenario as pass;
- golden replay report shows validator metrics as authoritative.

### Ek 3 - Assistants Fallback Runtime Type

Placement: Package 11/12 adapter selection and cutover documentation.

Rationale: fallback behavior is a model adapter runtime decision. Package 10
does not select provider fallback. Package 11/12 must explicitly choose and test
whether fallback is manual-flag-only or runtime-automatic.

Current preferred design: manual-flag-only until shadow evidence proves otherwise.

### Ek 4 - Numeric Automatic Rollback Thresholds

Placement: Package 12 shadow acceptance / canary readiness.

Rationale: thresholds need replay and shadow metrics. Package 10 can prepare
transition metrics, but rollback thresholds should be calibrated after Package
11 prompt repair and Package 12 multi-run replay.

### Ek 6 - Structured Facts Separation

Placement: context/knowledge fixture hardening before Package 11/12 replay.

Rationale: exact app facts, codes, limits, dates, and numeric facts should not
depend only on markdown blob extraction. This is related to the Package 04
`app_facts.md` fixture failure and should be treated as a context source
integrity problem before future replay/cutover decisions.

## Relationship To Package 04 Fixture Failure

Observed Package 04 rerun failure:

```text
ENOENT: no such file or directory, open '...\work\package04_adapter_contract\data\knowledge_bank\app_facts.md'
```

Evidence in Package 04 source shows tests and runtime helpers expect
`app_facts.md` under `data/knowledge_bank`, while the historical workspace does
not currently contain that file. The Dockerfile creates only a placeholder for
container tests.

Conclusion: Ek 6 is probably related at the architectural level. The immediate
Package 04 failure is a missing fixture/path issue, while Ek 6 is the deeper
design fix: exact facts should have structured, testable sources instead of
only markdown availability.

## Package 10 Initial Test Expectations

Package 10 should add or update tests for:

- non-mutating transition proposal creation;
- compact intake extraction into a valid proposal;
- selected app proposal only from approved apps;
- text-only preference proposal without unnecessary repetition;
- support/confusion signal proposal;
- `escalate_missing_info` proposal for missing knowledge/data;
- same candidate concurrent messages do not produce conflicting proposals;
- different candidates do not block each other;
- no state persistence occurs;
- no outbound send occurs.

## Exit Criteria

Package 10 may be accepted only if:

- build passes;
- relevant unit/contract tests pass;
- no-outbound transition-prep tests pass;
- addendum matrix is completed with evidence;
- Package 04 fixture relation is documented without silently marking it fixed;
- production impact is NO;
- real WhatsApp outbound is 0;
- rollback remains simple: disable transition-prep evaluator from shadow path.
