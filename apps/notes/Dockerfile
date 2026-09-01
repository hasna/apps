# syntax=docker/dockerfile:1
# =============================================================================
# @hasna/notes — notes-serve HTTP API image (personalnotes/v1 dialect).
# ARM64 / Bun. The service requires PostgreSQL through
# HASNA_NOTES_DATABASE_URL and fails closed when it is absent or invalid.
# =============================================================================
FROM --platform=linux/arm64 oven/bun:1-alpine AS base
WORKDIR /app

# Install runtime dependencies first (better layer caching). The workspace
# member manifests must be present for the workspace to resolve (the members
# themselves are not built in the server image). The app-level lockfile is
# not authoritative inside the monorepo (bun maintains the repo-root
# lockfile), so this build resolves from the manifests — the same choice the
# knowledge image makes.
COPY package.json ./
COPY server/package.json ./server/package.json
RUN bun install --ignore-scripts

# ---- runtime -----------------------------------------------------------------
FROM --platform=linux/arm64 oven/bun:1-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8788 \
    # The server's default bind is 127.0.0.1 for single-user local runs; a
    # container is reached through its published port, so listen on all
    # interfaces here.
    HASNA_NOTES_SERVER_HOST=0.0.0.0

# App code, deps, and the migration runner (owner-scoped migrations run as a
# one-shot task; the service itself runs as the app role).
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/package.json ./package.json
COPY bin ./bin
COPY cli ./cli
COPY client ./client
COPY sdk ./sdk
COPY scripts ./scripts
COPY server ./server
COPY src/generated ./src/generated
COPY tools ./tools

# Amazon RDS global CA bundle (public AWS artifact, truststore.pki.rds.amazonaws.com)
# so the storage kit's verified TLS (sslmode=require -> rejectUnauthorized:true)
# can validate the RDS server certificate. The kit also honours PGSSLROOTCERT.
RUN wget -q -O /etc/ssl/certs/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
  && chmod 644 /etc/ssl/certs/rds-global-bundle.pem

# Drop privileges (the bun base image ships a non-root `bun` user).
USER bun

EXPOSE 8788

# Liveness: the public /health probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1

# Default command: start the HTTP service. The migration task overrides the
# command with: bun scripts/apply-postgres-migrations.mjs
CMD ["bun", "bin/notes-serve.mjs"]
