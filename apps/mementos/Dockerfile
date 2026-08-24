# syntax=docker/dockerfile:1
# =============================================================================
# @hasna/mementos — service image (ARM64 / Bun)
# =============================================================================
FROM --platform=linux/arm64 oven/bun:1 AS build
WORKDIR /app

# Install all deps (incl. dev) for the build. --ignore-scripts: src/ is not
# copied yet, so defer the build to the explicit step below.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

# Build CLI + MCP + serve + SDK + lib bundles into dist/.
COPY . .
RUN bun run build

# -----------------------------------------------------------------------------
FROM --platform=linux/arm64 oven/bun:1 AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    MEMENTOS_HOST=0.0.0.0 \
    PORT=8080
# NOTE: MEMENTOS_CORS_ORIGIN is deliberately NOT defaulted here — it must be
# set by each deployment (docker-compose sets it to http://localhost:8080; the
# cloud hasna-app Terraform module env must set its public origin). Without it
# the default allowlist (http://localhost:19428) refuses 403 every
# state-changing request this container receives.

# Production dependencies only (pg, @hasna/contracts, ai sdk, etc.).
# --ignore-scripts: dist is copied from the build stage; no rebuild here.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

# Built artifacts + OCR language data (used by the extraction routes).
COPY --from=build /app/dist ./dist
COPY eng.traineddata ./eng.traineddata

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8080

# Lightweight liveness probe (compose/local; ECS uses the ALB target group).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["mementos-serve"]
