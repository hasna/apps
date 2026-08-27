# syntax=docker/dockerfile:1
# =============================================================================
# @hasna/computers — computers-serve HTTP API image (controller surface).
# ARM64 / Bun. The service reads/writes its SQLite store at the effective data
# home resolved via @hasna/paths (legacy ~/.hasna/computers until the resolver
# (XDG) home is adopted, or COMPUTERS_DB when set); the shipped PostgreSQL
# migrations are proven by scripts/test-postgres-migrations.sh.
# =============================================================================
FROM --platform=linux/arm64 oven/bun:1-alpine AS base
WORKDIR /app

# Install dependencies first (better layer caching). The app-level lockfile is
# not authoritative inside the monorepo (bun maintains the repo-root
# lockfile), so this build resolves from the manifest — the same choice the
# notes image makes.
COPY package.json ./
RUN bun install --ignore-scripts

# ---- build ------------------------------------------------------------------
FROM --platform=linux/arm64 oven/bun:1-alpine AS build
WORKDIR /app
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/package.json ./package.json
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
COPY schemas ./schemas
COPY migrations ./migrations
RUN bun run build

# ---- runtime -----------------------------------------------------------------
FROM --platform=linux/arm64 oven/bun:1-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    COMPUTERS_PORT=7788 \
    # The server's default bind is 127.0.0.1 for single-user local runs; a
    # container is reached through its published port, so listen on all
    # interfaces here.
    COMPUTERS_HOST=0.0.0.0

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/schemas ./schemas
COPY --from=build /app/migrations ./migrations

# Drop privileges (the bun base image ships a non-root `bun` user).
USER bun

EXPOSE 7788

# Liveness: the public /health probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${COMPUTERS_PORT}/health" || exit 1

# Default command: start the controller HTTP service.
CMD ["bun", "dist/bin/computers-serve.js"]
