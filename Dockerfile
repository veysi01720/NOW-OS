FROM node:20-alpine

ARG BUILD_TIMESTAMP=unknown
ARG SOURCE_TREE_HASH=unknown
ARG PACKAGE_LOCK_HASH=unknown
ARG DIST_TREE_HASH=unknown
ARG WORKSPACE_IDENTITY_HASH=unknown
ARG PROVENANCE_MANIFEST_HASH=unknown
ARG INTAKE_ARCHITECTURE_VERSION=1.1
ARG TEST_RESULT_REFERENCE=unknown

LABEL now_os.build_timestamp=$BUILD_TIMESTAMP \
      now_os.source_tree_hash=$SOURCE_TREE_HASH \
      now_os.package_lock_hash=$PACKAGE_LOCK_HASH \
      now_os.dist_tree_hash=$DIST_TREE_HASH \
      now_os.workspace_identity_hash=$WORKSPACE_IDENTITY_HASH \
      now_os.provenance_manifest_hash=$PROVENANCE_MANIFEST_HASH \
      now_os.intake_architecture_version=$INTAKE_ARCHITECTURE_VERSION \
      now_os.test_result_reference=$TEST_RESULT_REFERENCE

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY vitest.config.ts ./
COPY Dockerfile .dockerignore ./
COPY src/ ./src/
COPY docs/ ./docs/
COPY scripts/ ./scripts/
COPY workspace.identity.json ./
COPY build/provenance/source-manifest.json ./build/provenance/source-manifest.json
RUN mkdir -p data/knowledge_bank \
  && printf '# App Facts\n\nContainer test placeholder; runtime data volume overrides this file.\n' > data/knowledge_bank/app_facts.md

RUN test "$SOURCE_TREE_HASH" != "unknown" \
  && test "$PACKAGE_LOCK_HASH" != "unknown" \
  && test "$DIST_TREE_HASH" != "unknown" \
  && test "$WORKSPACE_IDENTITY_HASH" != "unknown" \
  && test "$PROVENANCE_MANIFEST_HASH" != "unknown" \
  && npm run build \
  && node scripts/verify-build-provenance.mjs \
       --manifest build/provenance/source-manifest.json \
       --expected-source "$SOURCE_TREE_HASH" \
       --expected-lock "$PACKAGE_LOCK_HASH" \
       --expected-dist "$DIST_TREE_HASH" \
       --expected-workspace "$WORKSPACE_IDENTITY_HASH" \
  && test "$(sha256sum build/provenance/source-manifest.json | cut -d ' ' -f1)" = "$PROVENANCE_MANIFEST_HASH"

# Don't copy .env or local data
# Data should be mounted as a volume at /app/data

EXPOSE 3000

CMD ["node", "dist/server.js"]
