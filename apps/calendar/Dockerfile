# @hasna/calendar service — ARM64 / Bun.
# Build from the monorepo root:
# docker build --platform linux/arm64 -f apps/calendar/Dockerfile -t calendar .
# Default CMD runs calendar-serve: the serve process reads/writes Postgres
# directly with @hasna/contracts API-key auth when HASNA_CALENDAR_DATABASE_URL
# is configured. The ECS one-shot migration task overrides the command with
# `... migrate`.

ARG BUN_IMAGE=oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0
ARG OPENSSL_VERSION=3.5.8-r0

# This is the multi-architecture index; the caller selects the target platform.
FROM ${BUN_IMAGE} AS base
ARG OPENSSL_VERSION
RUN test "$(bun --version)" = "1.3.14" \
 && apk add --no-cache "libcrypto3=${OPENSSL_VERSION}" "libssl3=${OPENSSL_VERSION}"

FROM base AS deps
WORKDIR /app
# The member lock resolves public registry packages, including Contracts auth.
# Do not copy the root workspace manifest or host node_modules into this stage.
COPY apps/calendar/package.json apps/calendar/bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

FROM deps AS build
WORKDIR /app
COPY apps/calendar/tsconfig.json ./
COPY apps/calendar/src ./src
# Bundle every dependency, including zod and Contracts, into the service.
RUN bun build src/server/index.ts --outdir dist/server --target bun

FROM base AS runner
WORKDIR /app
# Amazon RDS global CA bundle so TLS to the shared RDS succeeds under
# verify-full-capable clients.
COPY apps/calendar/docker/rds-global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
ENV NODE_ENV=production \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem \
    PGSSLROOTCERT=/etc/ssl/certs/rds-global-bundle.pem \
    CALENDAR_NO_OPEN=true \
    HOST=0.0.0.0 \
    PORT=19428
COPY apps/calendar/package.json ./
COPY --from=build /app/dist ./dist
COPY apps/calendar/docker/runner-bunfig.toml ./bunfig.toml
# The migration runner and cloud schema loader read the committed SQL at runtime.
COPY apps/calendar/migrations ./migrations
EXPOSE 19428
# Fail-closed: calendar-serve /v1 refuses to serve without an app-scoped DSN +
# signing secret, and /ready reports DB reachability — no silent stub.
CMD ["bun", "dist/server/index.js"]
