# syntax=docker/dockerfile:1

FROM oven/bun:1.3.13-slim AS build
WORKDIR /app

COPY package.json bun.lock tsconfig.json tsconfig.build.json ./
COPY src ./src

RUN bun install --frozen-lockfile
RUN bun run build
RUN bun install --production --frozen-lockfile

FROM oven/bun:1.3.13-slim AS runtime
ENV NODE_ENV=production \
    HASNA_UPTIME_MODE=hosted
WORKDIR /app

RUN addgroup --system --gid 10001 uptime \
  && adduser --system --uid 10001 --ingroup uptime uptime

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

RUN printf '#!/bin/sh\nexec bun /app/dist/cli/index.js "$@"\n' > /usr/local/bin/uptimemon \
  && chmod +x /usr/local/bin/uptimemon \
  && printf '#!/bin/sh\nexec bun /app/dist/cli/deprecated-uptime.js "$@"\n' > /usr/local/bin/uptime \
  && chmod +x /usr/local/bin/uptime

USER uptime
EXPOSE 3899

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "const r = await fetch('http://127.0.0.1:3899/health'); process.exit(r.ok ? 0 : 1)"

CMD ["bun", "dist/cli/index.js", "serve", "--mode", "hosted", "--host", "0.0.0.0", "--port", "3899"]
