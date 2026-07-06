# conversations-serve — ARM64 / Bun runtime image for the self_hosted service.
# PURE REMOTE (Amendment A1): the serve process talks to the shared cloud
# Postgres directly. No SQLite, no local state.
FROM oven/bun:1 AS base
WORKDIR /app

# ---- deps (cached) ----
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# ---- source ----
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY hasna.contract.json ./

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    HASNA_CONVERSATIONS_STORAGE_MODE=cloud

EXPOSE 8080

# Liveness: the ALB target group also hits /health.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Default: run the API server. The one-shot migration task overrides this with
# ["bun","run","src/server/migrate.ts"].
CMD ["bun", "run", "src/server/serve-entry.ts"]
