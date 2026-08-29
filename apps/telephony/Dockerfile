# syntax=docker/dockerfile:1
# =============================================================================
# @hasna/telephony — telephony-serve (self-hosted HTTP API) image.
# ARM64 / Bun. PURE REMOTE per Amendment A1: the service reads/writes the shared
# cloud Postgres directly. No local state. API-key auth via @hasna/contracts.
# =============================================================================
FROM --platform=linux/arm64 oven/bun:1-alpine AS build
WORKDIR /app

# Install dependencies first (better layer caching). The package postinstall
# (node postinstall.mjs) only pre-creates the host ~/.hasna/telephony data
# home — pointless here (PURE REMOTE, no local state) and it would fail the
# build anyway: postinstall.mjs is not copied into this layer yet ('Module not
# found /app/postinstall.mjs', measured on deploy pass 16, 2026-08-28). Skip
# lifecycle scripts, like the domains Dockerfile (O15-04208); the runtime
# recreates the same directories on first use.
COPY package.json bun.lock* ./
RUN bun install --ignore-scripts

# Build the CLI, MCP, serve bins + dist (also regenerates the OpenAPI SDK).
COPY . .
RUN bun run build

# ---- runtime -----------------------------------------------------------------
FROM --platform=linux/arm64 oven/bun:1-alpine AS runtime
WORKDIR /app
# Amazon RDS global CA bundle so TLS verification to the shared cloud Postgres
# succeeds (the vendored storage kit resolves sslmode=require with
# server-certificate verification enabled; without the RDS root in the trust
# store, the migrate/serve handshake fails with 'self signed certificate in
# certificate chain' — see O15-00669).
COPY docker/rds-global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
ENV NODE_ENV=production \
    PORT=8080 \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem \
    PGSSLROOTCERT=/etc/ssl/certs/rds-global-bundle.pem

# App code, deps, and the migration runner (owner-scoped migrations run as a
# one-shot task; the service itself runs as the app role).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/package.json ./package.json

# Drop privileges (the bun base image ships a non-root `bun` user).
USER bun

EXPOSE 8080

# Liveness: the public /health probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1

# Default command: start the HTTP service. The migration task overrides the
# command with: bun scripts/apply-cloud-migrations.mjs
CMD ["bun", "dist/server/cloud-entry.js"]
