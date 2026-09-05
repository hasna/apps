# syntax=docker/dockerfile:1
# @hasna/loops self-hosted control-plane - ARM64 / Bun.
# Default CMD runs loops-serve: the self-hosted service reads/writes RDS
# Postgres directly with @hasna/contracts API-key auth.
# The ECS one-shot migration task overrides the command with `... migrate`.
#
# Base pinned to the multi-arch image INDEX (application/vnd.oci.image.index.v1+json),
# never to one platform's manifest. The deploy lane
# (apps/loops/.github/workflows/ecr-candidate.yml) builds `--platform linux/arm64`
# on ubuntu-24.04-arm, but this file pinned a single-platform manifest digest AND
# forced `--platform=linux/amd64` on every stage — and those two contradicted each
# other: 3c9ab1a5… is oven/bun's linux/ARM64 manifest, so the candidate carried
# arm64 layers under an amd64 platform declaration. Pinning the index instead lets
# buildx resolve the manifest that matches the platform it was asked to build, the
# way apps/skills does. Index 5acc90a9… (verified against registry-1.docker.io)
# resolves to
#   linux/amd64 efc5e42c7bedc1661ab0b7272c74c3ebf794f054297f530a62055f2d1a0eb662
#   linux/arm64 3c9ab1a521c82144dff537125695017a0480d3a13088fba7e012cfae0f63146f
# so the amd64 digest apps/todos pins for its amd64 build stays reachable too.
#
# Scan gate: the lane fails the candidate on a single CRITICAL or HIGH from
# Trivy (os,library, ignore-unfixed off). Measured on the arm64 base, the only
# findings are libssl3/libcrypto3 3.5.6-r0 (CVE-2026-45447, CVE-2026-14456),
# closed by the OPENSSL_VERSION pin below.
#
# Nothing here needs glibc: loops is bun plus pure-JS dependencies (pg,
# @aws-sdk/client-secrets-manager, @modelcontextprotocol/sdk, ai, commander,
# zod), so the musl base needs no compatibility shim.
ARG BUN_IMAGE=oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0
ARG OPENSSL_VERSION=3.5.8-r0

FROM ${BUN_IMAGE} AS deps
WORKDIR /app
RUN test "$(bun --version)" = "1.3.14"
COPY package.json bun.lock ./
# --ignore-scripts: the package `prepare` script builds from src/ (absent here);
# the build stage runs `bun run build` explicitly after src/ is copied.
RUN bun install --frozen-lockfile --ignore-scripts

FROM ${BUN_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile --ignore-scripts
# Dependency tarballs that ship their own development lockfile (@hasna/secrets
# publishes package/bun.lock) make Trivy report the versions THAT package
# resolved during its own development - fast-uri 3.1.2, ip-address 10.2.0 -
# even though this image installs the hoisted, patched versions from
# apps/loops/bun.lock. The stale metadata is never read at runtime; drop it so
# the gate scores the tree that actually ships. Our own /app/bun.lock stays.
RUN find node_modules -type f \
      \( -name bun.lock -o -name bun.lockb -o -name package-lock.json \
         -o -name yarn.lock -o -name pnpm-lock.yaml \) -exec rm -f {} \;

FROM ${BUN_IMAGE} AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.json tsconfig.build.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY scripts ./scripts
COPY openapi ./openapi
RUN bun run build

FROM ${BUN_IMAGE} AS runner
ARG OPENSSL_VERSION
WORKDIR /app
# I38-00535: pin the CVE-fixed Alpine versions (postgresql16 16.15-r0, libpq
# 17.11-r0) so a vulnerable libpq/postgresql16-client never silently ships
# again — the build fails loudly if Alpine has not published the fixes.
# libssl3/libcrypto3 are pinned to the exact patched build for the same reason
# (an unpinned `apk upgrade` is whatever the index held that hour), and the
# result is asserted rather than assumed.
RUN apk upgrade --no-cache libcrypto3 libssl3 \
    && apk add --no-cache \
      "libcrypto3=${OPENSSL_VERSION}" \
      "libssl3=${OPENSSL_VERSION}" \
      'postgresql16-client>=16.15-r0' \
      'libpq>=17.11-r0' \
    && apk info -vv | grep -q "^libcrypto3-${OPENSSL_VERSION} - " \
    && apk info -vv | grep -q "^libssl3-${OPENSSL_VERSION} - " \
    && ! apk info -e glibc \
    && ! apk info -e perl
# Amazon RDS global CA bundle so the generated storage kit can verify TLS for
# sslmode=require, verify-ca, and verify-full RDS connections.
COPY docker/rds-global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
ENV NODE_ENV=production \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem \
    PGSSLROOTCERT=/etc/ssl/certs/rds-global-bundle.pem \
    HOST=0.0.0.0 \
    PORT=8787
COPY package.json bun.lock ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/lib/storage/fixtures/empty-tenant-backfill.json ./empty-tenant-backfill.json
USER bun
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD bun -e "const port=process.env.PORT||'8787'; fetch(`http://127.0.0.1:${port}/ready`).then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Fail-closed: loops-serve requires separate runtime/auth DSNs and a signing
# secret.
CMD ["bun", "dist/serve/index.js"]
