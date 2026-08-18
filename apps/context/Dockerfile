# syntax=docker/dockerfile:1
# =============================================================================
# @hasna/context — context-serve HTTP API image (documentation context server).
# ARM64 / Bun. The service reads/writes SQLite (default) or PostgreSQL
# (HASNA_CONTEXT_DATABASE_URL) — never both. A CONTEXT_HTTP_TOKEN must be set
# at run time: the server refuses to bind a non-local host without it.
# =============================================================================
FROM --platform=linux/arm64 oven/bun:1-alpine AS base
WORKDIR /app

# Runtime dependencies first (better layer caching). The app-level lockfile is
# not authoritative inside the monorepo (bun maintains the repo-root lockfile),
# so this build resolves from the manifest — the same choice the notes image
# makes.
COPY package.json ./
RUN bun install --ignore-scripts

# ---- build ------------------------------------------------------------------
FROM base AS build
COPY tsconfig.json ./
COPY src ./src
RUN bun run build

# ---- runtime -----------------------------------------------------------------
FROM --platform=linux/arm64 oven/bun:1-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=19431 \
    # The server's default bind is 127.0.0.1 for single-user local runs; a
    # container is reached through its published port, so listen on all
    # interfaces here.
    CONTEXT_HOST=0.0.0.0

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/package.json ./package.json
COPY --from=build /app/dist ./dist

# Amazon RDS global CA bundle (public AWS artifact, truststore.pki.rds.amazonaws.com)
# so PostgreSQL DSNs with verified TLS can validate the RDS server certificate.
RUN wget -q -O /etc/ssl/certs/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
  && chmod 644 /etc/ssl/certs/rds-global-bundle.pem

# Drop privileges (the bun base image ships a non-root `bun` user).
USER bun

EXPOSE 19431

# Liveness: the public /health probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["bun", "dist/server/index.js"]
