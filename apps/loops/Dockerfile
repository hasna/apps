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
    HASNA_LOOPS_STORAGE_MODE=cloud \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem \
    PGSSLROOTCERT=/etc/ssl/certs/rds-global-bundle.pem \
    HOST=0.0.0.0 \
    PORT=8787
COPY package.json bun.lock ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 8787
# Fail-closed: loops-serve refuses to start without a self-hosted DSN + signing
# secret on a non-local bind (no silent stub). HASNA_LOOPS_STORAGE_MODE=cloud is
# the generated storage-kit direct-Postgres flag; OpenLoops deployment mode is
# selected from HASNA_LOOPS_MODE or from the self-hosted database/API URL env.
CMD ["bun", "dist/serve/index.js"]
