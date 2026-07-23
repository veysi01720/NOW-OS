# V2 Job-Definition Grounding Design

Date: 2026-07-23
Scope: Quality Pack 1, offline only. No deploy, owner approval, or Package 13 canary action.

## Problem

Live V2/Assistants job-definition answers can fall back to sparse policy facts even though Package 11B introduced `app_facts_structured.json` as the machine-readable source. Production evidence showed the mounted knowledge bank had `app_facts.md`, `approved_learning.json`, and `approved_learning.md`, but did not have `app_facts_structured.json` or `app_routing_rules.md`. The V2 decision context therefore kept using `CandidatePolicyResolver` facts derived from `approvedApps`, not the canonical structured app facts.

## Source And Publish Design

`app_facts.md` remains the owner-approved human source of truth. A new offline-testable publish helper should derive two generated files from it:

- `app_facts_structured.json`: parsed from the markdown app table into typed app facts with Android name, iOS name, invite/agency codes, status, aliases, and capabilities.
- `app_routing_rules.md`: generated routing evidence for messaging/text-only candidates, especially the Layla/NIVI path when the source marks Layla as text-only.

The helper should be idempotent and local-filesystem only. It should not call OpenAI, Evolution, WhatsApp, VPS, or production deploy machinery. The safest integration point is `knowledgeSync.writeKnowledgeBankTarget()`, because owner-approved learning sync already writes local knowledge targets. After `approved_learning.json` and `approved_learning.md` are written, the helper can ensure the derived structured files exist when `app_facts.md` is available. If `app_facts.md` is missing, it should report a skipped/missing-source result instead of inventing facts.

## V2 Context Integration

`buildBackendContext()` already loads `structured_facts` through `loadStructuredAppFacts()`. The missing link is `buildConversationDecisionContext()`, which currently calls `resolveCandidatePolicy(state, approvedApps)` and projects only sparse static facts into `canonical_policy_facts`.

The narrow fix is to extend `CandidatePolicyResolver` so it can accept `structured_facts.app_facts` and add `knowledge_bank` policy facts when the structured file is loaded. The resolver should:

- prefer the selected app when present;
- otherwise prefer a text-only approved app such as Layla/NIVI for job-definition grounding;
- preserve existing static safety facts for work-model acceptance and account/payment boundaries;
- add a `structured_app_job_definition_*` fact that states the concrete work task, app names, text-only capability, and camera/video boundary.

This mirrors the Package 11B deterministic-normalizer discipline: model prompts may use facts, but canonical facts are structured, named, testable, and traceable to a source file.

## Acceptance Tests

Tests should prove:

1. The publish helper generates `app_facts_structured.json` and `app_routing_rules.md` from a temporary `app_facts.md` fixture.
2. Knowledge sync invokes the helper so approved-learning sync leaves derived structured files present.
3. V2 `conversation_decision_context_json.canonical_policy_facts` includes structured job-definition facts when `app_facts_structured.json` exists.
4. A candidate asking "is tam olarak nedir" can receive a reply grounded in the structured facts, including the real Layla/NIVI/text-only job definition, without inventing earnings, camera, account, or setup claims.

## Out Of Scope

- No automatic production publish.
- No vector store/File Search refresh.
- No owner live-control automation beyond the existing reviewed learning flow.
- No migration of historical conversation state.
