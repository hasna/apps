# syntax=docker/dockerfile:1
# @hasnaxyz/sandboxes self_hosted service — ARM64 / Bun.
# Default CMD runs sandboxes-serve (the /v1 API): it reads/writes the control
# plane in RDS Postgres and serves clients over HTTPS with API-key auth. The ECS
# one-shot migration task overrides the command with `... migrate`.

FROM --platform=linux/arm64 oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

FROM --platform=linux/arm64 oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.json tsconfig.build.json tsconfig.managed.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY scripts ./scripts
RUN bun run build

FROM --platform=linux/arm64 oven/bun:1 AS runner
WORKDIR /app
# Amazon RDS global CA bundle so TLS to the shared RDS verifies cleanly.
COPY docker/rds-global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
ENV NODE_ENV=production \
    HASNA_SANDBOXES_STORAGE_MODE=remote \
    HASNA_APP_MODE=self_hosted \
    HASNA_APP_NAME=sandboxes \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem \
    PGSSLROOTCERT=/etc/ssl/certs/rds-global-bundle.pem \
    HOST=0.0.0.0 \
    PORT=8080
COPY package.json bun.lock ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY schemas ./schemas
EXPOSE 8080
# Public GET /health is unauthenticated (ALB target-group health check on :8080);
# /v1 is fail-closed authed + tenant-scoped.
CMD ["bun", "dist/http/server.js"]
