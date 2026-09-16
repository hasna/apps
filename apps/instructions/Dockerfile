# syntax=docker/dockerfile:1
# @hasna/instructions server — ARM64 / Bun.
# Default CMD runs instructions-serve against the Postgres backend (the serve
# process reads/writes RDS Postgres directly, selected by the presence of
# HASNA_INSTRUCTIONS_DATABASE_URL). The ECS one-shot migration task overrides
# the command with `... migrate`.

FROM --platform=linux/arm64 oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

FROM --platform=linux/arm64 oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY scripts ./scripts
RUN bun run build:server

FROM --platform=linux/arm64 oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS runner
# The pinned Bun image currently carries OpenSSL 3.5.6-r0. Pin the first
# Alpine 3.22 package revision that fixes CVE-2026-14456 and CVE-2026-45447;
# an unavailable or regressed repository fails the image build closed.
RUN apk add --no-cache "libcrypto3=3.5.8-r0" "libssl3=3.5.8-r0"
WORKDIR /app
# Amazon RDS global CA bundle so TLS to the shared RDS succeeds under
# verify-full-capable clients.
COPY docker/rds-global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
ENV NODE_ENV=production \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem \
    PGSSLROOTCERT=/etc/ssl/certs/rds-global-bundle.pem \
    INSTRUCTIONS_NO_OPEN=true \
    HOST=0.0.0.0 \
    PORT=8080
COPY package.json bun.lock ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 8080
USER bun
# Fail-closed: instructions-serve /v1 refuses to serve without a cloud DSN +
# signing secret (503), and /ready reports DB reachability — no silent stub.
CMD ["bun", "dist/server/index.js"]
