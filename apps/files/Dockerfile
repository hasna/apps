# syntax=docker/dockerfile:1
# @hasna/files service — ARM64 / Bun.
# Default CMD runs files-serve (Postgres backend when HASNA_FILES_DATABASE_URL is set: the serve
# process reads/writes RDS Postgres directly with @hasna/contracts API-key auth;
# file bytes stay in S3). The ECS one-shot migration task overrides the command
# with `bun dist/server/migrate.js`.

# Pin the official Bun Alpine multi-arch index used by the passing ARM64 fleet
# lanes. The previous unpinned Debian image made every exact-source candidate
# fail the production image gate on Debian OS findings before deployment.
ARG BUN_IMAGE=oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0
ARG BUN_VERSION=1.3.14
ARG OPENSSL_VERSION=3.5.8-r0

FROM ${BUN_IMAGE} AS base
ARG BUN_VERSION
ARG OPENSSL_VERSION
RUN test "$(bun --version)" = "${BUN_VERSION}" \
 && apk add --no-cache \
      "libcrypto3=${OPENSSL_VERSION}" \
      "libssl3=${OPENSSL_VERSION}" \
 && apk info -vv | grep -q "^libcrypto3-${OPENSSL_VERSION} - " \
 && apk info -vv | grep -q "^libssl3-${OPENSSL_VERSION} - " \
 && apk info -vv | grep -q '^musl-1.2.5-r12 - ' \
 && apk info -vv | grep -q '^ca-certificates-bundle-20260413-r0 - ' \
 && ! apk info -e glibc \
 && ! apk info -e perl \
 && ! apk info -e sqlite-libs

FROM base AS deps
WORKDIR /app
COPY package.json bun.lock ./
# --ignore-scripts: the postinstall (scripts/ensure-data-dir.mjs) provisions a
# host data dir, which a container does not use; scripts/ is only copied in the
# build stage, so without this flag the frozen-lockfile install would run the
# postinstall with the script absent and fail (O15-00667 install-failure class).
RUN bun install --frozen-lockfile --ignore-scripts

FROM base AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY scripts ./scripts
# Service-only build (no CLI/MCP): produces dist/server/{index,migrate}.js
RUN bun run build:service

FROM base AS runner
WORKDIR /app
# Amazon RDS global CA bundle so verify-full TLS to the shared RDS succeeds
# (pg-connection-string escalates sslmode=require to verify-full).
COPY docker/rds-global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
ENV NODE_ENV=production \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem \
    PGSSLROOTCERT=/etc/ssl/certs/rds-global-bundle.pem \
    OPEN_FILES_REST_HOST=0.0.0.0 \
    PORT=19432
COPY package.json bun.lock ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 19432
# Fail-closed: files-serve /v1 refuses to serve without a cloud DSN + signing
# secret (no silent stub) — a missing signing secret surfaces as a 5xx.
CMD ["bun", "dist/server/index.js", "--port", "19432"]
