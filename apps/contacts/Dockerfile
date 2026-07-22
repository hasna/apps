# syntax=docker/dockerfile:1
# @hasna/contacts self_hosted service — ARM64 / Bun.
# Default CMD runs contacts-serve (cloud / PURE REMOTE per Amendment A1: the
# serve process reads/writes RDS Postgres directly with @hasna/contracts API-key
# auth). The ECS one-shot migration task overrides the command with `… migrate`.

ARG BUN_IMAGE=oven/bun:1.3.14-alpine@sha256:3c9ab1a521c82144dff537125695017a0480d3a13088fba7e012cfae0f63146f

FROM --platform=linux/arm64 ${BUN_IMAGE} AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY dashboard/package.json ./dashboard/package.json
RUN bun install --frozen-lockfile --ignore-scripts

FROM --platform=linux/arm64 ${BUN_IMAGE} AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY scripts ./scripts
RUN bun run build:server

FROM --platform=linux/arm64 ${BUN_IMAGE} AS runner
WORKDIR /app
# Amazon RDS global CA bundle so TLS to the shared RDS succeeds even for
# verify-full-capable clients.
COPY docker/rds-global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
ENV NODE_ENV=production \
    HASNA_CONTACTS_STORAGE_MODE=cloud \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem \
    PGSSLROOTCERT=/etc/ssl/certs/rds-global-bundle.pem \
    CONTACTS_NO_OPEN=true \
    CONTACTS_HOST=0.0.0.0 \
    HOST=0.0.0.0 \
    PORT=19428
COPY package.json bun.lock ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 19428
# Fail-closed: contacts-serve /v1 refuses to serve without a cloud DSN + signing
# secret (503), and /ready reports DB reachability — no silent stub.
CMD ["bun", "dist/server/index.js"]
