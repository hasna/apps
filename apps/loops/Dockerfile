# syntax=docker/dockerfile:1
# @hasna/loops self_hosted control-plane - ARM64 / Bun.
# Default CMD runs loops-serve: the self-hosted service reads/writes RDS
# Postgres directly with @hasna/contracts API-key auth.
# The ECS one-shot migration task overrides the command with `... migrate`.

FROM --platform=linux/arm64 oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
# --ignore-scripts: the package `prepare` script builds from src/ (absent here);
# the build stage runs `bun run build` explicitly after src/ is copied.
RUN bun install --frozen-lockfile --ignore-scripts
# @hasna/contracts is an optionalDependency resolved from the fleet-wide global
# bun store on client machines; it is NOT on the public npm registry, so the
# hermetic image build cannot fetch it. Vendor the exact 0.5.1 package into
# node_modules so both the build (tsc types + `@hasna/contracts/auth`) and the
# serve runtime resolve it. Both the build and runner stages inherit this
# node_modules via COPY --from=deps.
COPY vendor/contracts ./node_modules/@hasna/contracts

FROM --platform=linux/arm64 oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.json tsconfig.build.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY scripts ./scripts
COPY openapi ./openapi
RUN bun run build

FROM --platform=linux/arm64 oven/bun:1 AS runner
WORKDIR /app
# Amazon RDS global CA bundle so verify-full-capable TLS to the shared RDS
# succeeds (pg-connection-string escalates sslmode=require to verify-full).
COPY docker/rds-global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
ENV NODE_ENV=production \
    HASNA_LOOPS_STORAGE_MODE=self_hosted \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem \
    PGSSLROOTCERT=/etc/ssl/certs/rds-global-bundle.pem \
    HOST=0.0.0.0 \
    PORT=8787
COPY package.json bun.lock ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/lib/storage/fixtures/empty-tenant-backfill.json ./empty-tenant-backfill.json
EXPOSE 8787
# Fail-closed: loops-serve requires separate runtime/auth DSNs and a signing
# secret. HASNA_LOOPS_STORAGE_MODE=self_hosted is the only service mode value.
CMD ["bun", "dist/serve/index.js"]
