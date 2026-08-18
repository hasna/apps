# syntax=docker/dockerfile:1
# =============================================================================
# @hasna/crawl — self-hosted runtime for the crawl-serve REST API, MCP HTTP
# endpoint, and dashboard.
# Build:
#   docker buildx build --platform linux/amd64 -t crawl:latest .
# Runs `dist/server/index.js` (crawl-serve). No deployment or account defaults
# are embedded in the image; the operator supplies auth, storage, and provider
# configuration through environment variables.
# =============================================================================
FROM oven/bun:1.3.14 AS builder
WORKDIR /app

# Install dependencies against the committed lockfile.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Build all surfaces (cli, mcp, server, sdk, lib) into dist/.
COPY tsconfig.json ./
COPY src ./src
COPY openapi.json ./openapi.json
RUN bun run build

# Prune to production dependencies for the runtime image.
RUN rm -rf node_modules && bun install --frozen-lockfile --production

# -----------------------------------------------------------------------------
FROM oven/bun:1.3.14-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/openapi.json ./openapi.json
COPY package.json ./

# Non-root
USER bun
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/usr/local/bin/bun", "-e", "const port = Number(process.env.PORT || 8080); const r = await fetch(`http://127.0.0.1:${port}/health`); process.exit(r.ok ? 0 : 1)"]

CMD ["bun", "dist/server/index.js"]
