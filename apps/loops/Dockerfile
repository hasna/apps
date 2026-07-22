# syntax=docker/dockerfile:1
# @hasna/loops self_hosted control-plane - ARM64 / Bun.
# Default CMD runs loops-serve: the self-hosted service reads/writes RDS
# Postgres directly with @hasna/contracts API-key auth.
# The ECS one-shot migration task overrides the command with `... migrate`.

ARG BUN_IMAGE=oven/bun:1.3.13-alpine@sha256:588e1fb0d80ee1c09cc6e2d7d1ff8e3502191fba9cad12a4a77cb93d4d7f84f9

FROM --platform=linux/arm64 ${BUN_IMAGE} AS deps
WORKDIR /app
COPY package.json bun.lock ./
# --ignore-scripts: the package `prepare` script builds from src/ (absent here);
# the build stage runs `bun run build` explicitly after src/ is copied.
RUN bun install --frozen-lockfile --ignore-scripts
# @hasna/contracts is an optionalDependency resolved from the fleet-wide global
# bun store on client machines; it is NOT on the public npm registry, so the
# hermetic image build cannot fetch it. Vendor the exact 0.5.1 package into
# node_modules so both the build (tsc types + `@hasna/contracts/auth`) and the
# serve runtime resolve it. The build stage inherits this node_modules tree;
# the production stage vendors the same package after its production install.
COPY vendor/contracts ./node_modules/@hasna/contracts

FROM --platform=linux/arm64 ${BUN_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile --ignore-scripts
COPY vendor/contracts ./node_modules/@hasna/contracts
# This ECS image is intentionally limited to loops-serve and the one-shot
# migration command. It is not a CLI, runner, daemon, or MCP distribution.
# Remove the MCP SDK and its AJV-only validation subtree from the production
# dependency tree; the build stage retains the complete locked dependencies.
RUN rm -rf \
    node_modules/@modelcontextprotocol \
    node_modules/ajv \
    node_modules/ajv-formats \
    node_modules/fast-deep-equal \
    node_modules/fast-uri \
    node_modules/json-schema-traverse \
    node_modules/require-from-string

FROM --platform=linux/arm64 ${BUN_IMAGE} AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.json tsconfig.build.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY scripts ./scripts
COPY openapi ./openapi
RUN bun run build

FROM --platform=linux/arm64 ${BUN_IMAGE} AS runner
WORKDIR /app
RUN apk upgrade --no-cache libcrypto3 libssl3 openssl
# Amazon RDS global CA bundle so verify-full-capable TLS to the shared RDS
# succeeds (pg-connection-string escalates sslmode=require to verify-full).
COPY docker/rds-global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
ENV NODE_ENV=production \
    HASNA_LOOPS_STORAGE_MODE=cloud \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem \
    PGSSLROOTCERT=/etc/ssl/certs/rds-global-bundle.pem \
    HOST=0.0.0.0 \
    PORT=8787
COPY package.json bun.lock ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER bun
EXPOSE 8787
# Fail-closed: loops-serve refuses to start without a self-hosted DSN + signing
# secret on a non-local bind (no silent stub). HASNA_LOOPS_STORAGE_MODE=cloud is
# the generated storage-kit direct-Postgres flag; OpenLoops deployment mode is
# selected from HASNA_LOOPS_MODE or from the self-hosted database/API URL env.
CMD ["bun", "dist/serve/index.js"]
