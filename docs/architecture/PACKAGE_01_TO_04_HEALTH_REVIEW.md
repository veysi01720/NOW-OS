# Packages 01-04 Architecture Health Review

Evidence date: 2026-07-15

## Executive Status

The first four packages establish a trustworthy runtime identity, quarantine non-canonical local senders, seal architecture ownership, make builds reproducible, and repair the model adapter contract. They do not activate Responses API or change production behavior.

| Package | Result | Architecture effect |
| --- | --- | --- |
| 01 Canonical Runtime Audit | `COMPLETE_WITH_TRACKED_FINDINGS` | Established the VPS source/runtime baseline and exposed source-image drift. |
| 01B Local Runtime Quarantine | `COMPLETE_WITH_PRESERVED_ROLLBACK` | Disabled non-canonical local messaging/model runtimes without deletion. |
| 02 Architecture Ownership Seal | `SEALED_WITH_EXPLICIT_MIGRATION_BLOCKERS` | Assigned one owner to authority, state, knowledge, model execution, validation, and outbound. |
| 03 Build Provenance Seal | `COMPLETE_CANDIDATE_IMAGE_SEALED_NOT_DEPLOYED` | Bound source, lockfile, dist, workspace identity, tests, and image labels. |
| 04 Canonical Model Adapter Contract | `IMPLEMENTED_CANDIDATE_NOT_DEPLOYED` | Unified adapters on one type-checked interface and removed direct provider execution from the service. |

## What Is Solid

- Canonical production identity is known and guarded.
- Local duplicate messaging runtimes are inactive and fail closed.
- Backend remains the authority for roles, state, policy, validation, queues, and outbound.
- One factory-selected Assistant adapter preserves the current provider, model binding, thread mapping, and response contract.
- Responses code is isolated, source-only, and runtime-unselected.
- Build provenance can fail closed on source, dependency, dist, workspace, or manifest mismatch.
- Exact-image and no-network acceptance can run without real WhatsApp outbound.
- Group, command, internal-note, source-integrity, and architecture regression suites remain available.

## Finding Resolution Matrix

| Finding | Package 04 state | Evidence |
| --- | --- | --- |
| P1-F01 build provenance not authoritative | `RESOLVED` | Package 03 manifest and immutable image labels. |
| P1-F02 source ahead of production | `CONTROLLED` | Candidate images are explicit; production remains unchanged until approved deploy. |
| P1-F03/P1-F04 local duplicate and credential risk | `MITIGATED` | Package 01B quarantine; permanent deletion deferred. |
| P1-F05 degraded inbound observation | `OUTSIDE_PACKAGE_04` | Requires runtime observation, not adapter repair. |
| P1-F06 V1/V2 contracts coexist | `OPEN_MIGRATION_STATE` | Adapter boundary is ready; contract convergence is not complete. |
| P1-F07 stale external process | `OPEN_LOW_PRIORITY` | Cleanup remains separately controlled. |
| P2-F01 split adapter contracts | `RESOLVED` | One `run/health/getIdentity` interface, no production adapter suppression. |
| P2-F02 direct Assistant branch | `RESOLVED` | Both flag states execute through `IModelAdapter.run`. |
| P2-F03 stale Responses design | `RESOLVED` | Source-only/unselected status documented and statically guarded. |
| P2-F04 oversized inbound orchestrator | `OPEN_MEDIUM` | Deliberately not refactored in migration foundation. |
| P2-F05 repeated role resolution | `OPEN_LOW` | Authority result should later be computed once and passed downstream. |
| P2-F06 multiple state patch paths | `OPEN_MEDIUM` | A single backend state-transition application boundary is still needed. |

## Remaining Architectural Risks

### Migration blockers

1. V1 owner/manager output and V2 candidate decisions still coexist.
2. Responses V3 is not connected to factory selection, shadow execution, or runtime flags.
3. A single state-transition application boundary does not yet own all deterministic and model-proposed state patches.
4. The inbound orchestrator remains large, so future changes must use narrow typed extraction rather than broad rewrites.

### Operational risks

1. Inbound observability can be intermittent; live WhatsApp smoke alone is not a reliable release gate.
2. Quarantined local containers and historical credentials still exist as rollback evidence until a separate deletion package.
3. Production is intentionally still on the earlier running image; candidate success is not production activation proof.
4. Source-only Responses tests use a fake runtime and do not prove production account/model/schema availability.

## Readiness Decision

Package 04 closes the prerequisites for a source-only Responses shadow package. It does not authorize a provider switch.

The next package may add a backend-owned, default-off Responses selection/shadow boundary only if it preserves:

- Assistant as the default and rollback adapter;
- no real outbound in acceptance;
- strict V3 schema plus backend validation;
- no provider-owned state authority;
- immutable provenance and exact-image verification;
- explicit rollback on any contract, quality, or egress mismatch.

## Overall Decision

`PACKAGES_01_TO_04_FOUNDATION_STATUS=HEALTHY_WITH_TRACKED_MIGRATION_DEBT`

The foundation is substantially safer than the pre-package baseline. The remaining work is migration and orchestration debt, not an unknown runtime-ownership problem.
