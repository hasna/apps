# syntax=docker/dockerfile:1
# @hasna/todos self_hosted service — ARM64 / Bun.
# Default CMD runs todos-serve (cloud / PURE REMOTE per Amendment A1: the serve
# process reads/writes RDS Postgres directly with @hasna/contracts API-key auth).
# The ECS one-shot migration task overrides the command with `... migrate`.

ARG BUN_IMAGE=oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4
ARG OPENSSL_VERSION=3.5.6-1~deb13u2

FROM --platform=linux/arm64 ${BUN_IMAGE} AS base
ARG OPENSSL_VERSION
# Keep the Bun runtime reproducible while applying Debian's security-fixed
# OpenSSL source package. Exact pins and the package assertion make a stale or
# incomplete mirror fail the build instead of shipping a vulnerable image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      "openssl=${OPENSSL_VERSION}" \
      "libssl3t64=${OPENSSL_VERSION}" \
      "openssl-provider-legacy=${OPENSSL_VERSION}" \
    && dpkg-query -W openssl libssl3t64 openssl-provider-legacy \
      | awk -v expected="${OPENSSL_VERSION}" '$2 != expected { exit 1 } END { if (NR != 3) exit 1 }' \
    && rm -rf /var/lib/apt/lists/*

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
WORKDIR /app
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
