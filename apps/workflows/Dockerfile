# syntax=docker/dockerfile:1
# @hasna/workflows self-hosted — ARM64 / Bun.
# Default CMD runs workflows-serve: the HTTP surface (/health, /ready,
# /version, /openapi.json). Slice 1 is sqlite-only and binds localhost by
# default; the container sets HASNA_WORKFLOWS_HOST=0.0.0.0.

FROM --platform=linux/arm64 oven/bun:1.3-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

FROM --platform=linux/arm64 oven/bun:1.3-alpine AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.json tsconfig.build.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
RUN bun run build

FROM --platform=linux/arm64 oven/bun:1.3-alpine AS runner
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile --ignore-scripts
COPY --from=build /app/dist ./dist
COPY --from=build /app/types ./types
ENV NODE_ENV=production \
    HASNA_WORKFLOWS_HOST=0.0.0.0 \
    HASNA_WORKFLOWS_PORT=8790
EXPOSE 8790
ENTRYPOINT ["bun", "dist/serve/index.js"]
