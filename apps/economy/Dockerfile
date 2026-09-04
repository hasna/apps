# syntax=docker/dockerfile:1
# @hasna/economy self_hosted control-plane — ARM64 / Bun.
# Default CMD runs economy-serve (cloud / PURE REMOTE per Amendment A1: the serve
# process reads/writes RDS Postgres directly with @hasna/contracts API-key auth).
# The ECS one-shot migration task overrides the command with `... migrate`.

FROM --platform=linux/amd64 oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
# --ignore-scripts: postinstall only makes a local training dir; not needed here.
RUN bun install --frozen-lockfile --ignore-scripts

FROM --platform=linux/amd64 oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY openapi ./openapi
# Build the service bins only (no web dashboard). Local imports are bundled;
# node_modules stay external and are provided at runtime.
RUN bun build src/server/index.ts       --outdir dist/server --target bun --packages external \
 && bun build src/db/pg-sync-worker.ts   --outdir dist/server --target bun --packages external \
 && bun build src/mcp/index.ts           --outdir dist/mcp    --target bun --packages external \
 && bun build src/cli/index.ts           --outdir dist/cli    --target bun --packages external \
 && bun build src/index.ts               --outdir dist        --target bun --packages external

FROM --platform=linux/amd64 oven/bun:1 AS runner
WORKDIR /app
# Amazon RDS global CA bundle so verify-full-capable TLS to the shared RDS
# succeeds (pg-connection-string escalates sslmode=require to verify-full).
COPY docker/rds-global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
# No storage-mode variable: the server data backend is selected by the presence
# of HASNA_ECONOMY_DATABASE_URL, injected at run time. Baking a retired
# HASNA_ECONOMY_STORAGE_MODE into the image now fails closed at startup.
ENV NODE_ENV=production \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem \
    PGSSLROOTCERT=/etc/ssl/certs/rds-global-bundle.pem \
    ECONOMY_HOST=0.0.0.0 \
    ECONOMY_PORT=8787
COPY package.json bun.lock ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 8787
# Fail-closed: economy-serve refuses a non-local bind without an API signing
# secret (no silent stub). The migration task overrides CMD with `migrate`.
CMD ["bun", "dist/server/index.js", "--port", "8787"]
