# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# @hasna/shortlinks — ARM64 (Fargate) container for shortlinks-serve.
# PURE REMOTE (Amendment A1): the service talks to RDS Postgres directly.
# ---------------------------------------------------------------------------
FROM oven/bun:1 AS build
WORKDIR /app

# Install dependencies against the committed lockfile. --ignore-scripts because
# postinstall/prepare would run before src is copied.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

# Build the dist bundles (cli, mcp, serve, sdk).
COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src
RUN bun run build

# Prune to production dependencies for the runtime image.
RUN rm -rf node_modules && bun install --frozen-lockfile --production --ignore-scripts

# ---------------------------------------------------------------------------
FROM oven/bun:1-slim AS runtime
WORKDIR /app
# The Amazon RDS certs chain to a PRIVATE "Amazon RDS <region> Root CA" that is
# not in the public/system trust store. Bundle the RDS global CA and trust it so
# pg's TLS (sslmode=require is treated as verify-full by pg>=8.20) verifies the
# RDS chain instead of failing with "self signed certificate in certificate chain".
ENV NODE_ENV=production \
    PORT=8080 \
    HASNA_SHORTLINKS_STORAGE_MODE=cloud \
    NODE_EXTRA_CA_CERTS=/etc/ssl/rds/global-bundle.pem \
    PGSSLROOTCERT=/etc/ssl/rds/global-bundle.pem

ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/rds/global-bundle.pem

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# `shortlinks-serve` on PATH so ECS command overrides (serve / migrate) work.
RUN printf '#!/bin/sh\nexec bun /app/dist/serve/index.js "$@"\n' > /usr/local/bin/shortlinks-serve \
    && chmod +x /usr/local/bin/shortlinks-serve

EXPOSE 8080
CMD ["shortlinks-serve"]
