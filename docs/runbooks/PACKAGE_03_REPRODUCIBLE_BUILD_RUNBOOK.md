# Package 03 - Reproducible Build Runbook

## Preconditions

- Work only in the canonical source root.
- Preserve the running production image id and container start time.
- Do not copy `.env`, production data or backups into a build artifact.
- Do not deploy as part of provenance generation.

## Build Sequence

```text
npm ci
npm run build
npm test
npm run provenance:generate -- --test-result <sanitized-test-reference>
npm run provenance:verify
```

Read the generated manifest and pass its hashes explicitly as Docker build
arguments. Never substitute `unknown` and never infer a hash from a different
workspace.

Required build arguments:

```text
BUILD_TIMESTAMP
SOURCE_TREE_HASH
PACKAGE_LOCK_HASH
DIST_TREE_HASH
WORKSPACE_IDENTITY_HASH
PROVENANCE_MANIFEST_HASH
TEST_RESULT_REFERENCE
```

## Candidate Verification

1. Inspect all `now_os.*` labels.
2. Compare labels to `build/provenance/source-manifest.json`.
3. Compare the manifest file SHA-256 to the manifest label.
4. Run full tests inside the exact image with network disabled.
5. Start an isolated container with dummy credentials, isolated data and no
   network.
6. Verify process health from inside the container.
7. Confirm no webhook was submitted and no Evolution send endpoint was called.

## Deployment Separation

Candidate build success is not deployment approval. A later package must name
the exact image id, verify rollback and obtain explicit owner approval before a
backend-only recreate.

## Failure Handling

- Source mismatch: stop and regenerate from the canonical source.
- Lock mismatch: stop; do not run `npm install` to rewrite the lockfile.
- Dist mismatch: rebuild from clean dependencies and inspect nondeterminism.
- Manifest mismatch: do not tag or deploy the image.
- Exact-image test or startup failure: keep production unchanged and record the
  candidate as rejected.
