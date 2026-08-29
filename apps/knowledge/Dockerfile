# syntax=docker/dockerfile:1
# =============================================================================
# @hasna/knowledge — knowledge-serve HTTP API image.
# ARM64 / Bun. The service reads/writes PostgreSQL and stores artifacts in S3.
#
# The base images are pinned to the EXACT bun patch the byte-reproducibility
# guard expects (bun-version: in .github/workflows/ci.yml, enforced by
# scripts/check-bun-version.mjs, which `bun run build` runs first). A floating
# tag (oven/bun:1-alpine) drifts past the pin — bun patch releases emit
# different bundle bytes for the same source — and the guard then refuses to
# build, blocking the knowledge deploy at image build time (O15-04947). Keep
# this pin in lockstep with the ci.yml bun-version pin and the committed
# bin/ + dist/ bundles.
# =============================================================================
FROM --platform=linux/arm64 oven/bun:1.3.14-alpine AS build
WORKDIR /app

# Install dependencies first (better layer caching). The repo does not commit a
# lockfile (*.lock is gitignored), so resolve from package.json.
COPY package.json ./
RUN bun install

# Build the CLI, MCP, serve bins + dist (also regenerates the OpenAPI SDK).
COPY . .
RUN bun run build

# ---- runtime -----------------------------------------------------------------
# Same exact-patch pin as the build stage — see the header note (O15-04947).
FROM --platform=linux/arm64 oven/bun:1.3.14-alpine AS runtime
WORKDIR /app
# Amazon RDS global CA bundle so TLS verification to the shared cloud Postgres
# succeeds (the storage kit resolves sslmode=require with server-certificate
# verification enabled; without the RDS root in the trust store, the
# migrate/serve handshake fails with 'self signed certificate in certificate
# chain' — see O15-00668).
COPY docker/rds-global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
ENV NODE_ENV=production \
    PORT=8080 \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem \
    PGSSLROOTCERT=/etc/ssl/certs/rds-global-bundle.pem

# App code, deps, and the migration runner (owner-scoped migrations run as a
# one-shot task; the service itself runs as the app role).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/bin ./bin
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
# command with: bun scripts/apply-postgres-migrations.mjs
CMD ["bun", "bin/knowledge-serve.js"]
