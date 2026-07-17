# Package 02 - Architecture Ownership Seal

## Document Control

- Package: `PACKAGE-02 Architecture Ownership Seal`
- Evidence date: `2026-07-15`
- Canonical source inspected: `/root/deploy_package/now_os_backend`
- Canonical runtime: VPS service/container `now_os_backend`
- Runtime command: `node dist/server.js`
- Production code or configuration changed: `NO`
- OpenAI, Evolution, webhook, database or state changed: `NO`
- Real WhatsApp outbound: `0`
- Status: `SEALED_WITH_EXPLICIT_MIGRATION_BLOCKERS`

This seal defines who is allowed to own each decision in the canonical message
path. It does not claim that source-only migration files are deployed, and it
does not authorize cleanup or a provider switch.

## Canonical Flow

```text
Evolution webhook
-> normalizeEvolutionMessage
-> message idempotency and run lock
-> backend role/authority resolution
-> deterministic group, command and file gates
-> candidate intake extraction
-> persistent state and memory read
-> backend context and policy projection
-> model execution boundary
-> strict decision/response validation
-> backend-owned state patch validation
-> one public reply selection
-> sendReply
-> EvolutionApiSender.sendText
```

No model or provider owns authority, state persistence, knowledge approval,
queue cutover or WhatsApp delivery.

## Ownership Rules

1. `normalizeEvolutionMessage` owns provider payload normalization.
2. `resolveSenderRole` owns role authority. User claims never grant a role.
3. `candidateIntakeStateMachine` owns deterministic age, gender and daily-hours
   extraction from the current candidate message.
4. `PersistentJsonStore` implementations own current persistent user state,
   memory, thread mapping and message deduplication.
5. `buildBackendContext` owns the base backend context. Candidate V2 context is
   a projection built by `ConversationContextBuilder`, not a second database.
6. `AllowedActionResolver` and `CandidatePolicyResolver` own allowed actions and
   canonical candidate facts supplied to a model.
7. `ModelExecutionService` is the required model boundary. Provider SDK shapes
   must not cross it.
8. The active candidate decision contract is Conversation Decision V2. The
   active owner/manager general response contract is Assistant Response Contract
   V1.0. Conversation Decision V3 is a migration target only.
9. `ConversationDecisionValidator`, `SemanticQualityGuard` and
   `StatePatchValidator` own backend acceptance of candidate model output.
10. `sendReply -> EvolutionApiSender.sendText` owns synchronous production
    outbound. The queue worker is dormant while workers and queue-only flags are
    off and may not become a second sender.
11. Knowledge ingestion, review, approval and publish are backend operations.
    Model output cannot update active knowledge directly.
12. The logger, decision trace and Connection Doctor own sanitized runtime
    observability. Raw phone, JID, prompt, provider body or secret values are
    outside the observability contract.

## Active Contract Classification

| Contract or boundary | State | Runtime scope | Decision |
| --- | --- | --- | --- |
| `NormalizedIncomingMessage` | `ACTIVE` | all inbound | keep |
| `BackendContextPayloadV1` | `ACTIVE` | all model paths | keep, later narrow additively |
| Candidate intake state machine | `ACTIVE` | private candidate | keep authoritative |
| Conversation Decision V2 | `ACTIVE` | private candidate | keep until V3 parity and canary |
| Assistant Response Contract V1.0 | `ACTIVE_FALLBACK` | owner/manager general and legacy boundary | isolate, retire only after parity |
| `ModelAdapterInput/Output` from `types.ts` | `LEGACY_ADAPTER_SHAPE` | current adapter-layer code | isolate |
| `ModelExecutionRequest/Result` from `IModelAdapter.ts` | `TARGET_ADAPTER_SHAPE` | source-only foundation | repair before Responses integration |
| Conversation Decision V3 | `MIGRATION_TARGET` | canonical source only | preserve, not production proof |
| `ResponsesAdapter` | `MIGRATION_TARGET` | canonical source only | preserve, currently unselected |
| Behavior context/state | `FEATURE_OFF_ISOLATED` | disabled by runtime flags | no rollout in migration packages |
| Reliability queue workers | `SHADOW_OR_OFF` | disabled in production | no cutover in migration packages |

## Verified Coupling Findings

### P2-F01 - Adapter contract split is hidden by TypeScript suppression

- Severity: `HIGH`
- `IModelAdapter.ts` defines `execute`, `health` and `getIdentity`.
- `AssistantAdapter` implements the older `run(ModelAdapterInput)` shape.
- `modelAdapterFactory.ts` and `AssistantAdapter.ts` use `@ts-nocheck`.
- `ModelExecutionService` calls `adapter.run`, while the imported interface
  declares `execute`.
- Consequence: a green build cannot certify adapter substitutability.
- Required action: a later code package must choose one canonical adapter
  contract, remove suppression and run both adapters through one contract suite.

### P2-F02 - ModelExecutionService contains a provider-specific legacy branch

- Severity: `HIGH`
- The service imports `runAssistantWithBackendContext`, creates OpenAI threads
  and invokes the Assistants path directly when the adapter flag is off.
- Consequence: the nominal model boundary is not provider-neutral internally.
- Required action: wrap legacy Assistants execution behind the same canonical
  adapter contract before Responses shadow execution is connected.

### P2-F03 - Architecture document and source state drift

- Severity: `MEDIUM`
- `RESPONSES_ADAPTER_DESIGN_V1.md` still says design-only and says the adapter
  file must not exist.
- Canonical source contains `ResponsesAdapter.ts` and V3 schema files.
- The running image contains neither source nor compiled Responses/V3 files.
- Consequence: source documents can falsely describe both source and runtime.
- Required action: keep this seal authoritative and revise the old design status
  only in the Responses foundation package.

### P2-F04 - Central orchestrator has excessive ownership surface

- Severity: `MEDIUM`
- `handleIncomingMessage.ts` coordinates role checks, state machine execution,
  behavior state, memory writes, V1/V2 model routing, validation and send.
- Consequence: a local fix can bypass another layer or create ordering defects.
- Required action: do not rewrite it now. Future packages must extract only
  typed boundaries and keep one orchestration owner.

### P2-F05 - Role resolution is invoked in multiple modules

- Severity: `LOW`
- The same backend resolver is called by the handler, backend-context builder
  and intake state machine.
- The algorithm is single-source, but repeated resolution creates drift risk.
- Required action: compute an authority context once and pass it downstream in
  a future additive refactor.

### P2-F06 - Multiple state patch mechanisms coexist

- Severity: `MEDIUM`
- Deterministic intake, behavior conversation state and V2 state patches all
  reach `UserStateStore` through different orchestration branches.
- Consequence: field ownership is implicit.
- Required action: preserve the field-level rules in the ownership matrix and
  introduce one state transition application boundary before expanding V3.

## Provider Coupling Decision

The provider-neutral context boundary is:

```text
NormalizedIncomingMessage
+ AuthorityContext
+ BackendContext
+ PersistentConversationState
+ ApprovedKnowledgeSummary
+ RuntimeConstraints
-> ModelExecutionRequest
```

Provider-specific thread ids, Assistant ids, run objects, Responses blocks and
SDK clients may exist only inside provider adapters. The target Responses path
is initially stateless from the backend perspective. Provider conversation
state cannot replace backend persistence.

## Forbidden Dependency Directions

- Bridge/domain code must not import the OpenAI SDK.
- A provider adapter must not call Evolution or write user state.
- The model must not grant roles, execute commands, approve knowledge or send a
  WhatsApp message.
- State persistence must not parse provider responses.
- Knowledge review/publish must not be triggered by ordinary candidate model
  output.
- Outbound must never use raw provider output or `internal_boss_note`.
- Queue and synchronous paths must never both send the same message.
- Source-only Responses/V3 files must not be described as deployed behavior.

## KEEP / ISOLATE / RETIRE-LATER

### KEEP

- Canonical webhook and normalizer
- Backend role whitelist resolution
- Candidate intake extraction
- Persistent state, memory and dedupe stores
- Backend context and candidate policy resolvers
- Candidate V2 validators and state patch evidence checks
- Public/internal response separation
- One canonical Evolution sender
- Sanitized trace and Connection Doctor
- Approved knowledge review and publish separation
- Source-only Responses/V3 migration work

### ISOLATE

- OpenAI Assistants client and thread store
- Assistant Response Contract V1.0
- Direct legacy branch inside `ModelExecutionService`
- Behavior Orchestrator and behavior conversation state while feature-off
- Queue workers and shadow queue while cutover-off
- ResponsesAdapter and V3 schema until contract repair and shadow acceptance
- Knowledge publisher SDK usage behind owner-approved publish operations

### RETIRE-LATER

- Direct provider execution branch in `ModelExecutionService`
- Duplicate adapter request/output type families
- `@ts-nocheck` in model adapter production files
- General V1 response path after V3 parity, shadow and rollback proof
- Provider-owned thread state after Assistants fallback retirement
- Duplicate role resolution calls after AuthorityContext introduction
- Feature-off behavior state duplication if the later architecture rejects it

`RETIRE-LATER` is not deletion approval.

## Package 03 Entry Criteria

The next package is `Build Provenance and Reproducible Release Seal`. It must:

1. establish immutable source identity for the canonical source tree;
2. generate source, lockfile, build and image hashes;
3. embed verifiable labels in a candidate image;
4. prove host source, image source and compiled output correspondence;
5. preserve the running production image as rollback;
6. perform no provider switch or Responses activation.

Responses foundation work may begin only after Package 03 is accepted. Its
first blocker is P2-F01, not a production flag change.

## Acceptance Decision

`PACKAGE_02_STATUS=SEALED_WITH_EXPLICIT_MIGRATION_BLOCKERS`

Ownership is sufficiently explicit to prevent another patch-driven expansion.
The blockers are assigned to later code packages and do not require a runtime
change in this documentation package.
