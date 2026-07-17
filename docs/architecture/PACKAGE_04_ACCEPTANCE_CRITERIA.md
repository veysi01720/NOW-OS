# Package 04 Acceptance Criteria

Package 04 is accepted only when all gates pass:

1. `IModelAdapter` exposes one `run/health/getIdentity` contract.
2. `AssistantAdapter`, `ResponsesAdapter`, factory, service, and test adapters compile against it.
3. No production adapter file uses `@ts-nocheck`.
4. `ModelExecutionService` contains no direct Assistant run call.
5. Flag-off behavior retains legacy output semantics and provider identity.
6. Assistant remains the only runtime factory selection.
7. Responses remains source-only and unselected.
8. Targeted adapter, architecture, replay, resilience, and full suites pass.
9. Build and provenance verification pass.
10. Immutable exact-image tests pass with network disabled.
11. Isolated startup returns health and readiness without real outbound.
12. Production image, container start time, health, readiness, webhook, Evolution, database, and state remain unchanged.

Rollback requires no database action. Preserve the pre-Package-04 source archive, Package 03 candidate, and current running production image.
