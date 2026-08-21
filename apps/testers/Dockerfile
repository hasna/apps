# syntax=docker/dockerfile:1
# =============================================================================
# testers — ARM64 / bun service image (testers-serve + testers CLI/MCP)
# Amendment A1: serve talks to cloud Postgres directly. No browsers are needed
# for the HTTP data-plane, so browser downloads are skipped.
# =============================================================================

# ---- builder ----------------------------------------------------------------
FROM oven/bun:1 AS builder
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PUPPETEER_SKIP_DOWNLOAD=1

# I38-00566: there is NO committed apps/testers/bun.lock (verified at
# origin/main), so `COPY package.json bun.lock ./` failed every build with
# "COPY failed: /bun.lock not found". The lockfile cannot be generated while
# the manifest pins @hasna/browser@0.5.18, which is not on the npm registry
# (measured E404 2026-08-21; latest published is 0.5.16 — the frozen-lock gate
# carries testers on its UNRESOLVABLE_PINS list for exactly this reason). So
# the deps stage follows the telephony sibling pattern (non-frozen install,
# globbed lockfile copy): `bun.lock*` copies the lockfile when one exists and
# resolves from the manifest otherwise. The build can only leave this state
# when the owning release lane publishes @hasna/browser@0.5.18 (or repins).
COPY package.json bun.lock* ./
RUN bun install

COPY . .
# Build only the runtime surfaces (dashboard/types not needed to serve /v1).
RUN bun run build:cli \
 && bun run build:mcp \
 && bun run build:server \
 && bun run build:lib \
 && bun run build:sdk

# ---- runtime ----------------------------------------------------------------
FROM oven/bun:1-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/package.json ./package.json

# Bins on PATH (matches the fleet convention: <name>, <name>-serve, <name>-mcp).
RUN printf '#!/bin/sh\nexec bun /app/dist/cli/index.js "$@"\n'    > /usr/local/bin/testers      && chmod +x /usr/local/bin/testers     \
 && printf '#!/bin/sh\nexec bun /app/dist/server/index.js "$@"\n' > /usr/local/bin/testers-serve && chmod +x /usr/local/bin/testers-serve \
 && printf '#!/bin/sh\nexec bun /app/dist/mcp/index.js "$@"\n'    > /usr/local/bin/testers-mcp  && chmod +x /usr/local/bin/testers-mcp

EXPOSE 8080

# Container-level healthcheck (the ALB target group also probes /health).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["testers-serve"]
