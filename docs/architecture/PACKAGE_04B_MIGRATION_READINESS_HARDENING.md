# Package 04B - Migration Readiness Hardening

Status: ACCEPTED CANDIDATE / NOT DEPLOYED / PRODUCTION UNCHANGED

## Scope

Package 04B closes narrow architecture debt before Responses shadow work. It does not select Responses, change provider/model/Assistant binding, deploy production, alter Evolution/webhook/database, or send a real WhatsApp message.

## Authority Boundary

The canonical production handler resolves an `AuthorityContext` once from backend whitelists and projects it into candidate intake and backend-context construction. User claims do not affect authority.

Direct unit callers retain a compatibility fallback, but the canonical inbound path performs one role resolution.

## State Transition Boundary

All production `UserStateStore.updateState` calls now pass through `applyUserStateTransition`. The boundary:

- clones mutable arrays before persistence;
- rejects candidate transitions for non-candidate or non-private authority;
- rejects empty conversation keys;
- avoids unchanged writes;
- identifies the transition source.

Sources are `candidate_intake`, `conversation_decision_v2`, `behavior_snapshot`, and `behavior_transition`. State validation remains with the owning domain validator before this persistence boundary.

## Routing Matrix

| Role/scope | Behavior eligibility | Route |
| --- | --- | --- |
| private candidate with V2 enabled | any | `conversation_decision_v2` |
| eligible owner/manager behavior scope | true | `assistant_response_v1_behavior` |
| remaining legacy scope | false | `assistant_response_v1_legacy` |

Group and deterministic command gates run before model routing and remain unchanged.

## Observability Readiness

Connection Doctor adds a migration-readiness projection:

- Responses shadow requires confirmed gateway reachability, healthy receiving, and recent inbound observation.
- Live cutover additionally requires recent send observation.
- Failure reason codes are sanitized and no raw identity or message content is included.

## Deferred Work

- Full V1/V2 contract convergence remains a migration outcome, not a pre-shadow refactor.
- Large handler decomposition is limited to typed boundaries; broad rewrite is deferred.
- Local container deletion and credential-history cleanup remain a separate controlled cleanup package.
- Production Responses selection remains Package 5 scope and must default off.
