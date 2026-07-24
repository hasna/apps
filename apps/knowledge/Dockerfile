# =============================================================================
# @hasna/knowledge — Stage-A contained knowledge-serve image.
# ARM64 / Bun. The service exposes liveness, version, and OpenAPI metadata;
# readiness and every data route remain typed 403/503 containment. It does not
# construct Postgres, S3, auth, or provider clients during normal service boot.
# =============================================================================
FROM --platform=linux/arm64 oven/bun:1.3.13-alpine@sha256:4de475389889577f346c636f956b42a5c31501b654664e9ae5726f94d7bb5349 AS build
WORKDIR /app

# Install the reviewed dependency graph before copying build inputs.
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

# Build the CLI, MCP, serve bins + dist (also regenerates the OpenAPI SDK).
COPY src ./src
COPY scripts ./scripts
COPY tsconfig.json tsconfig.build.json ./
RUN bun scripts/build.mjs

# ---- runtime -----------------------------------------------------------------
FROM --platform=linux/arm64 oven/bun:1.3.13-alpine@sha256:4de475389889577f346c636f956b42a5c31501b654664e9ae5726f94d7bb5349 AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080

# Built runtime targets are self-contained with respect to package source.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/bin ./bin
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# Drop privileges (the bun base image ships a non-root `bun` user).
USER bun

EXPOSE 8080

# Liveness: the public /health probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1

# Default command: contained liveness/metadata service.
CMD ["bun", "bin/knowledge-serve.js"]
