# syntax=docker/dockerfile:1
# @hasna/hooks self-hosted registry - ARM64 / Bun.
# Default CMD runs hooks-serve: the local registry HTTP API (catalog, lock,
# artifact reads; PUT publish gated by HASNA_HOOKS_API_KEY). The image ships
# the bundled hook payloads from hooks/ so the served catalog is complete.

FROM --platform=linux/arm64 oven/bun:1.3-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
# --ignore-scripts: the postinstall only creates ~/.hasna/hooks in the host
# home, which a container does not use.
RUN bun install --frozen-lockfile --ignore-scripts

FROM --platform=linux/arm64 oven/bun:1.3-alpine AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.json tsconfig.build.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY scripts ./scripts
RUN bun run build

FROM --platform=linux/arm64 oven/bun:1.3-alpine AS runner
WORKDIR /app
# Amazon RDS global CA bundle so TLS verification to the shared cloud Postgres
# succeeds (the hooks PG adapter verifies with rejectUnauthorized: true and no
# explicit ca; without the RDS root in the trust store, the migrate/serve
# handshake fails with 'self signed certificate in certificate chain' — see
# O15-00682).
COPY docker/rds-global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile --ignore-scripts
COPY --from=build /app/bin ./bin
COPY --from=build /app/dist ./dist
COPY hooks ./hooks
# CLI shim so `hooks …` works (e.g. the one-shot migration task: hooks migrate).
RUN printf '#!/bin/sh\nexec bun /app/bin/index.js "$@"\n' > /usr/local/bin/hooks \
  && chmod +x /usr/local/bin/hooks
ENV NODE_ENV=production \
    HOST=127.0.0.1 \
    PORT=39428 \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem \
    PGSSLROOTCERT=/etc/ssl/certs/rds-global-bundle.pem
EXPOSE 39428
CMD ["bun", "bin/serve.js"]
