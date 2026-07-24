# syntax=docker/dockerfile:1
# @hasna/files self_hosted service — ARM64 / Bun.
# Default CMD runs files-serve (cloud / PURE REMOTE per Amendment A1: the serve
# process reads/writes RDS Postgres directly with @hasna/contracts API-key auth;
# file bytes stay in S3). The ECS one-shot migration task overrides the command
# with `bun dist/server/migrate.js`.

FROM --platform=linux/arm64 oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM --platform=linux/arm64 oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY scripts ./scripts
# Service-only build (no dashboard/CLI/MCP): produces dist/server/{index,migrate}.js
RUN bun run build:service

FROM --platform=linux/arm64 oven/bun:1 AS runner
WORKDIR /app
# Amazon RDS global CA bundle so verify-full TLS to the shared RDS succeeds
# (pg-connection-string escalates sslmode=require to verify-full).
COPY docker/rds-global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
ENV NODE_ENV=production \
    HASNA_FILES_STORAGE_MODE=cloud \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem \
    PGSSLROOTCERT=/etc/ssl/certs/rds-global-bundle.pem \
    OPEN_FILES_REST_HOST=0.0.0.0 \
    PORT=19432
COPY package.json bun.lock ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 19432
# Fail-closed: files-serve /v1 refuses to serve without a cloud DSN + signing
# secret (no silent stub) — a missing signing secret surfaces as a 5xx.
CMD ["bun", "dist/server/index.js", "--port", "19432"]
