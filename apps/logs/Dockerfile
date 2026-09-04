# syntax=docker/dockerfile:1
# @hasna/logs — ARM64 Bun image for the PostgreSQL-backed serve.
# The container runs logs-serve against PostgreSQL: a stateless API in front of
# the shared Postgres with API-key auth. The same image runs the one-shot
# migration task (command override: ["logs","db","migrate"]).

FROM --platform=linux/arm64 oven/bun:1.3.13-slim AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json bun.lock tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY sdk ./sdk
RUN bun install --frozen-lockfile
# Runtime needs only the bundled JS (dist/*.js); skip .d.ts emission.
RUN bun run build:js
RUN rm -rf node_modules && bun install --production --frozen-lockfile

FROM --platform=linux/arm64 oven/bun:1.3.13-slim AS runtime
# Amazon RDS global CA bundle so TLS verification to the shared cloud Postgres
# succeeds (the storage kit resolves sslmode=require with server-certificate
# verification enabled; without the RDS root in the trust store, the
# migrate/serve handshake fails with 'self signed certificate in certificate
# chain' — see O15-00661).
COPY docker/rds-global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PORT=8080 \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem \
    PGSSLROOTCERT=/etc/ssl/certs/rds-global-bundle.pem
WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# CLI shim so `logs …` works (e.g. the migration task: logs db migrate).
RUN printf '#!/bin/sh\nexec bun /app/dist/cli/index.js "$@"\n' > /usr/local/bin/logs \
  && chmod +x /usr/local/bin/logs

# Run as the non-root `bun` user that the oven/bun base image provides.
USER bun
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "const r = await fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health'); process.exit(r.ok ? 0 : 1)"

CMD ["bun", "dist/server/index.js"]
