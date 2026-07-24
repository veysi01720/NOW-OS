FROM node:20-alpine

ARG BUILD_TIMESTAMP=unknown
ARG INTAKE_ARCHITECTURE_VERSION=1.1
ARG TEST_RESULT_REFERENCE=unknown

LABEL now_os.build_timestamp=$BUILD_TIMESTAMP \
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
RUN mkdir -p data/knowledge_bank \
  && printf '# App Facts\n\nContainer test placeholder; runtime data volume overrides this file.\n' > data/knowledge_bank/app_facts.md

# Package 16: provenance is generated and verified entirely inside this
# build, from the files that were just COPY'd above and the dist/ this
# same RUN produces. There is no host-computed hash input anymore, so a
# host/container build drift (different OS, different tsc invocation)
# cannot cause a false provenance mismatch - the only files that exist
# are the ones actually baked into this image.
RUN npm run build \
  && node scripts/generate-build-provenance.mjs --test-result "$TEST_RESULT_REFERENCE" \
  && node scripts/verify-build-provenance.mjs --manifest build/provenance/source-manifest.json

# now_os.source_tree_hash / package_lock_hash / dist_tree_hash /
# workspace_identity_hash / provenance_manifest_hash labels are stamped
# AFTER this build completes, by scripts/stamp-image-provenance-labels.mjs,
# which reads build/provenance/source-manifest.json back out of the built
# image (docker cp) and commits it as image labels - never recomputed
# independently, so the labels can only ever match what is actually inside
# the image.

# Don't copy .env or local data
# Data should be mounted as a volume at /app/data

EXPOSE 3000

CMD ["node", "dist/server.js"]
