# syntax=docker/dockerfile:1
# =============================================================================
# @hasna/domains — ARM64 container for the domains-serve HTTP API.
# Build (native arm64):
#   docker buildx build --platform linux/arm64 -t domains:latest .
# Runs `domains-serve` (PURE REMOTE / Amendment A1 — talks to cloud Postgres).
# The one-shot migration task overrides CMD with: domains db migrate
# =============================================================================

FROM oven/bun:1.3.13 AS builder
WORKDIR /app

# Install dependencies against the committed lockfile.
# --ignore-scripts: the postinstall only pre-creates the host ~/.hasna/domains
# data home, which a container does not use — this image is Postgres-only, no
# local state, and the runtime (src/lib/app-home.ts) creates the same directory
# on first use. Running it here would fail the build: postinstall.js is not
# copied into this layer.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

# Build all surfaces (cli, mcp, server, sdk, lib) into dist/.
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN bun run build

# Prune to production dependencies for the runtime image.
# --ignore-scripts: same reason as the deps install above — the postinstall
# would fail here (postinstall.js is not in this layer) and is meaningless in
# a container that keeps no local state.
RUN rm -rf node_modules && bun install --frozen-lockfile --production --ignore-scripts

# -----------------------------------------------------------------------------
FROM oven/bun:1.3.13-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    HASNA_APP_NAME=domains

# Amazon RDS global CA bundle so sslmode=require (verify-full under current pg)
# verifies the RDS server certificate. Referenced by PGSSLROOTCERT / the kit TLS.
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/rds-global-bundle.pem
# ADD from a URL leaves the file root-only (0600); make it world-readable so the
# non-root `bun` user can load it as NODE_EXTRA_CA_CERTS / PGSSLROOTCERT.
RUN chmod 0644 /etc/ssl/rds-global-bundle.pem
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/rds-global-bundle.pem \
    PGSSLROOTCERT=/etc/ssl/rds-global-bundle.pem

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# Non-root
USER bun
EXPOSE 8080

# Default: the HTTP API. Migration task overrides with ["domains","db","migrate"].
CMD ["bun", "dist/server/index.js"]
