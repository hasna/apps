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
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Build all surfaces (cli, mcp, server, sdk, lib) into dist/.
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN bun run build

# Prune to production dependencies for the runtime image.
RUN rm -rf node_modules && bun install --frozen-lockfile --production

# -----------------------------------------------------------------------------
FROM oven/bun:1.3.13-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    HASNA_APP_NAME=domains \
    HASNA_APP_MODE=self_hosted

# Amazon RDS global CA bundle so sslmode=require (verify-full under current pg)
# verifies the RDS server certificate. Referenced by PGSSLROOTCERT / the kit TLS.
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/rds-global-bundle.pem
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
