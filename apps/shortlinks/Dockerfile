# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# @hasna/shortlinks — ARM64 (Fargate) container for shortlinks-serve.
# The service talks to PostgreSQL directly: a HASNA_SHORTLINKS_DATABASE_URL
# (provided by the ECS task) selects the postgresql server data backend.
# ---------------------------------------------------------------------------
# Pinned multi-architecture Alpine index plus the exact patched OpenSSL floor
# used by the fleet's zero-CRITICAL/HIGH deployment lanes. A floating Alpine
# tag can regress between review and deploy, so both Bun and runtime libraries
# are asserted in the image build.
ARG BUN_IMAGE=oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0
ARG BUN_VERSION=1.3.14
ARG OPENSSL_VERSION=3.5.8-r0

FROM --platform=linux/amd64 ${BUN_IMAGE} AS build
ARG BUN_VERSION
RUN test "$(bun --version)" = "${BUN_VERSION}"
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
FROM --platform=linux/amd64 ${BUN_IMAGE} AS runtime
ARG BUN_VERSION
ARG OPENSSL_VERSION
WORKDIR /app
RUN test "$(bun --version)" = "${BUN_VERSION}" \
    && apk add --no-cache \
      "libcrypto3=${OPENSSL_VERSION}" \
      "libssl3=${OPENSSL_VERSION}" \
    && apk info -vv | grep -q "^libcrypto3-${OPENSSL_VERSION} - " \
    && apk info -vv | grep -q "^libssl3-${OPENSSL_VERSION} - " \
    && ! apk info -e perl \
    && ! apk info -e util-linux
# The Amazon RDS certs chain to a PRIVATE "Amazon RDS <region> Root CA" that is
# not in the public/system trust store. Bundle the RDS global CA and trust it so
# pg's TLS (sslmode=require is treated as verify-full by pg>=8.20) verifies the
# RDS chain instead of failing with "self signed certificate in certificate chain".
ENV NODE_ENV=production \
    PORT=8080 \
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
