# syntax=docker/dockerfile:1
# =============================================================================
# @hasna/tenants — self-hosted runtime for the tenants-serve REST API (IdP).
# Build:
#   docker buildx build --platform linux/amd64 -t tenants:latest .
# Runs `dist/server/index.js` (tenants-serve). The server data backend is
# PostgreSQL, selected by the operator-supplied HASNA_TENANTS_DATABASE_URL; no
# deployment or account defaults are embedded in the image.
# =============================================================================
FROM oven/bun:1.3.14 AS builder
WORKDIR /app

# Install dependencies against the committed lockfile.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Build all surfaces (cli, mcp, server, sdk, db, migrations) into dist/.
COPY tsconfig.json ./
COPY src ./src
RUN bun run build

# Prune to production dependencies for the runtime image.
RUN rm -rf node_modules && bun install --frozen-lockfile --production

# -----------------------------------------------------------------------------
FROM oven/bun:1.3.14-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=15460 \
    HOST=0.0.0.0

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# Non-root
USER bun
EXPOSE 15460

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/usr/local/bin/bun", "-e", "const port = Number(process.env.PORT || 15460); const r = await fetch(`http://127.0.0.1:${port}/health`); process.exit(r.ok ? 0 : 1)"]

CMD ["bun", "dist/server/index.js"]
