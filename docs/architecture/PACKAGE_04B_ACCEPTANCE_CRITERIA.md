# Package 04B Acceptance Criteria

1. Canonical handler resolves authority exactly once and passes it downstream.
2. Candidate intake and backend context do not independently resolve production authority.
3. Production state writes occur only through the state-transition boundary.
4. Candidate state writes fail closed for owner, manager, group, or unknown authority.
5. Existing intake, behavior, V2 state, persistence, owner, fake-manager, and group tests pass.
6. V1/V2 routing matrix is deterministic and logged without raw identity data.
7. Connection Doctor exposes Responses shadow and live-cutover readiness separately.
8. Responses remains runtime-unselected and Assistant remains default.
9. Full, exact-image, no-network, and no-outbound acceptance passes.
10. Production remains unchanged and rollback evidence is preserved.
