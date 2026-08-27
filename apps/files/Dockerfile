# syntax=docker/dockerfile:1
# @hasna/files service — ARM64 / Bun.
# Default CMD runs files-serve (Postgres backend when HASNA_FILES_DATABASE_URL is set: the serve
# process reads/writes RDS Postgres directly with @hasna/contracts API-key auth;
# file bytes stay in S3). The ECS one-shot migration task overrides the command
# with `bun dist/server/migrate.js`.

FROM --platform=linux/arm64 oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
# --ignore-scripts: the postinstall (scripts/ensure-data-dir.mjs) provisions a
# host data dir, which a container does not use; scripts/ is only copied in the
# build stage, so without this flag the frozen-lockfile install would run the
# postinstall with the script absent and fail (O15-00667 install-failure class).
RUN bun install --frozen-lockfile --ignore-scripts

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
