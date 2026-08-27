# syntax=docker/dockerfile:1
# ARM64 (Graviton) image for sessions-serve, built on Bun. Amendment A1: the
# service runs in cloud mode and reads/writes the shared RDS directly.

# ---- builder: install deps + produce dist/ --------------------------------
FROM oven/bun:1 AS builder
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json hasna.contract.json ./
COPY src ./src
COPY migrations ./migrations
RUN bun run build:cli && bun run build:mcp && bun run build:server && bun run build:lib && bun run build:sdk

# ---- runtime: slim image with dist + prod deps + migrations ---------------
FROM oven/bun:1-slim AS runtime
WORKDIR /app
# Amazon RDS global CA bundle so TLS verification to the shared cloud Postgres
# succeeds. The vendored storage kit (src/generated/storage-kit/tls.ts)
# resolves the CA from PGSSLROOTCERT / NODE_EXTRA_CA_CERTS and verifies with
# rejectUnauthorized: true under sslmode=require; without the RDS root in the
# image the handshake fails with 'self signed certificate in certificate
# chain' and the container never serves /ready — see O15-04014.
COPY docker/rds-global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3456 \
    HASNA_SESSIONS_STORAGE_MODE=cloud \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem \
    PGSSLROOTCERT=/etc/ssl/certs/rds-global-bundle.pem

# curl for the container HEALTHCHECK against /health.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY --from=builder /app/dist ./dist
COPY migrations ./migrations
COPY hasna.contract.json ./hasna.contract.json

EXPOSE 3456

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/health" || exit 1

# Default: HTTP server. Migration one-shot: override CMD with
#   ["bun","dist/server/index.js","migrate"]  (run with the OWNER DSN).
CMD ["bun", "dist/server/index.js"]
