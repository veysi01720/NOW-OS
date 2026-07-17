# Package 07 Acceptance Criteria

## Reconciliation

1. Package 4, 4B, 5, and 6 source differences are enumerated by relative path and hash.
2. VPS canonical source is compared through a secrets-free, read-only source archive.
3. Every VPS-to-candidate difference is assigned to an accepted package scope.
4. No unexpected deletion, legacy adapter restoration, parallel outbound path, or credential artifact is present.
5. Package 7 has exactly one behavioral source parent: Package 6.

## Documentation

1. Package 4, 4B, 5, and 6 status headers match their acceptance evidence.
2. Candidate success is never described as production deployment.
3. Package 6 quality failure remains explicit and blocks Responses cutover.
4. The current Assistant remains canonical and rollback-capable.

## Build And Safety

1. Workspace preflight, build, and complete test suite pass.
2. Architecture and source-integrity regression tests pass.
3. Provenance generation and verification pass.
4. Immutable candidate image labels match source, lock, dist, workspace, and manifest hashes.
5. Exact-image tests and isolated default-off startup pass.
6. Real OpenAI and WhatsApp outbound counts remain zero.
7. Production image, start time, health, readiness, Evolution, webhook, database, and binding remain unchanged.

## Package Decision

Package 07 is complete only when one reconciled candidate hash is produced and every safety gate passes. Completion authorizes Package 08 contract work, not deployment or Responses activation.
