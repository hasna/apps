# syntax=docker/dockerfile:1
# @hasna/loops self_hosted control-plane - ARM64 / Bun.
# Default CMD runs loops-serve: the self-hosted service reads/writes RDS
# Postgres directly with @hasna/contracts API-key auth.
# The ECS one-shot migration task overrides the command with `... migrate`.

ARG BUN_IMAGE=oven/bun:1.3.13-alpine@sha256:588e1fb0d80ee1c09cc6e2d7d1ff8e3502191fba9cad12a4a77cb93d4d7f84f9

FROM --platform=linux/arm64 ${BUN_IMAGE} AS deps
WORKDIR /app
COPY package.json bun.lock ./
# --ignore-scripts: the package `prepare` script builds from src/ (absent here);
# the build stage runs `bun run build` explicitly after src/ is copied.
RUN bun install --frozen-lockfile --ignore-scripts

FROM --platform=linux/arm64 ${BUN_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile --ignore-scripts

FROM --platform=linux/arm64 ${BUN_IMAGE} AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.json tsconfig.build.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY scripts ./scripts
COPY openapi ./openapi
RUN bun run build

FROM --platform=linux/arm64 ${BUN_IMAGE} AS runner
WORKDIR /app
# Amazon RDS global CA bundle so the generated storage kit can verify TLS for
# sslmode=require, verify-ca, and verify-full RDS connections.
COPY docker/rds-global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
ENV NODE_ENV=production \
    HASNA_LOOPS_STORAGE_MODE=self_hosted \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem \
    PGSSLROOTCERT=/etc/ssl/certs/rds-global-bundle.pem \
    HOST=0.0.0.0 \
    PORT=8787
COPY package.json bun.lock ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/lib/storage/fixtures/empty-tenant-backfill.json ./empty-tenant-backfill.json
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD bun -e "const port=process.env.PORT||'8787'; fetch(`http://127.0.0.1:${port}/ready`).then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Fail-closed: loops-serve requires separate runtime/auth DSNs and a signing
# secret. HASNA_LOOPS_STORAGE_MODE=self_hosted is the only service mode value.
CMD ["bun", "dist/serve/index.js"]
