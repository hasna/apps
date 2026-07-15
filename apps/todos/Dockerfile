# syntax=docker/dockerfile:1
# @hasna/todos self_hosted service — ARM64 / Bun.
# Default CMD runs todos-serve (cloud / PURE REMOTE per Amendment A1: the serve
# process reads/writes RDS Postgres directly with @hasna/contracts API-key auth).
# The ECS one-shot migration task overrides the command with `... migrate`.

ARG BUN_IMAGE=oven/bun:1.3.14-alpine@sha256:3c9ab1a521c82144dff537125695017a0480d3a13088fba7e012cfae0f63146f
ARG BASH_VERSION=5.2.37-r0

FROM --platform=linux/arm64 ${BUN_IMAGE} AS base
# The single-platform digest resolves directly to the official linux/arm64
# Bun 1.3.14 Alpine manifest. Assert the musl boundary and the immutable base's
# security-relevant package floor so an accidental digest or platform change
# fails during the build.
RUN test "$(bun --version)" = "1.3.14" \
    && test "$(apk info -v musl)" = "musl-1.2.5-r12" \
    && test "$(apk info -v libcrypto3)" = "libcrypto3-3.5.6-r0" \
    && test "$(apk info -v libssl3)" = "libssl3-3.5.6-r0" \
    && test "$(apk info -v ca-certificates-bundle)" = "ca-certificates-bundle-20260413-r0" \
    && ! apk info -e glibc \
    && ! apk info -e perl \
    && ! apk info -e sqlite-libs

FROM base AS deps
WORKDIR /app
# Root manifest + the dashboard workspace member's manifest (needed for the
# workspace to resolve; the dashboard itself is not built in the server image).
COPY package.json bun.lock ./
COPY dashboard/package.json ./dashboard/package.json
RUN bun install --frozen-lockfile --ignore-scripts

FROM base AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY scripts ./scripts
RUN bun run build:server

FROM base AS runner
ARG BASH_VERSION
WORKDIR /app
# The previous Debian runtime included bash, and the bundled event-hook and
# agent-run paths invoke bash explicitly. Preserve that supported boundary with
# one exact Alpine package; git and tmux were not present in the predecessor
# image and remain intentionally outside the cloud container contract.
RUN apk add --no-cache "bash=${BASH_VERSION}" \
    && test "$(apk info -v bash)" = "bash-${BASH_VERSION}" \
    && ! command -v git \
    && ! command -v tmux
# Amazon RDS global CA bundle so TLS to the shared RDS succeeds even under
# verify-full-capable clients.
COPY docker/rds-global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
ENV NODE_ENV=production \
    HASNA_TODOS_STORAGE_MODE=remote \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem \
    PGSSLROOTCERT=/etc/ssl/certs/rds-global-bundle.pem \
    TODOS_NO_OPEN=true \
    HOST=0.0.0.0 \
    PORT=19427
COPY package.json bun.lock ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 19427
# Fail-closed: todos-serve /v1 refuses to serve without a cloud DSN + signing
# secret (503), and /ready reports DB reachability — no silent stub.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["bun", "-e", "const response = await fetch('http://127.0.0.1:19427/ready'); if (!response.ok) process.exit(1);"]
CMD ["bun", "dist/server/index.js"]
