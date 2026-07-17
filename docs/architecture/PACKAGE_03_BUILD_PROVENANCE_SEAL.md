# Package 03 - Build Provenance and Reproducible Release Seal

## Purpose

Bind canonical source, dependency lockfile, compiled output, provenance manifest
and Docker image identity without changing the production runtime.

## Identity Chain

```text
canonical source file set
-> source_tree_hash

package-lock.json
-> package_lock_hash

TypeScript build output
-> dist_tree_hash

workspace.identity.json
-> workspace_identity_hash

all hashes + test result reference
-> build/provenance/source-manifest.json
-> provenance_manifest_hash

Docker build verifies all manifest hashes again
-> immutable candidate image labels
```

## Source Hash Scope

Included:

- `src/`
- `docs/`
- `scripts/`
- `Dockerfile`
- `.dockerignore`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `vitest.config.ts`
- `workspace.identity.json`

Excluded:

- `.env`
- `data/`
- `backups/`
- `node_modules/`
- generated `dist/` from the source hash
- generated `build/provenance/`

Compiled `dist/` has its own deterministic tree hash. Mutable production data
and secrets can never enter a build identity manifest.

## Fail-Closed Rules

The Docker build fails when any required build argument is `unknown`, when the
manifest does not match the build context, when compiled output differs, or
when the manifest file hash differs from the supplied label value.

Required labels:

- `now_os.source_tree_hash`
- `now_os.package_lock_hash`
- `now_os.dist_tree_hash`
- `now_os.workspace_identity_hash`
- `now_os.provenance_manifest_hash`
- `now_os.build_timestamp`
- `now_os.test_result_reference`

## Runtime Boundary

Package 03 creates a candidate image only. It does not recreate the production
container and does not change provider, model, Assistant binding, Responses
selection, Evolution, webhook, database, state, queue, workers or Fast ACK.

## Acceptance Gates

1. Workspace preflight passes.
2. Dependency install uses `npm ci`.
3. TypeScript build passes.
4. Full tests pass without skip/removal.
5. Provenance generation and verification pass.
6. Candidate Docker build rejects unknown or mismatched hashes.
7. Candidate image labels equal the generated manifest.
8. Exact-image tests pass with network disabled.
9. Isolated startup uses dummy credentials, isolated data and no network.
10. Exact-image real WhatsApp outbound count is zero.
11. Production image, start time, health and readiness remain unchanged.

## Rollback

No runtime rollback is required because Package 03 does not deploy the
candidate image. The currently running image remains the production rollback
reference. Source changes can be restored from the Package 03 pre-change backup
only with explicit owner approval.

## Next Boundary

Responses foundation work can start only after Package 03 acceptance. The first
code task is adapter contract unification from Package 02 finding P2-F01. No
Responses flag or production provider switch is implied by this seal.
