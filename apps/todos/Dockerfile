# @hasna/todos Stage A containment-only image — ARM64 / Bun.
# This artifact proves an install-free build but intentionally starts only the
# dependency-light help surface. It is not an operational service image.

ARG BUN_IMAGE=oven/bun:1.3.14-alpine@sha256:3c9ab1a521c82144dff537125695017a0480d3a13088fba7e012cfae0f63146f
ARG BASH_VERSION=5.2.37-r0
ARG OPENSSL_VERSION=3.5.7-r0

FROM ${BUN_IMAGE} AS base
ARG OPENSSL_VERSION
# The single-platform digest resolves directly to the official linux/arm64
# Bun 1.3.14 Alpine manifest. Assert the musl boundary and the immutable base's
# security-relevant package floor so an accidental digest or platform change
# fails during the build. The official immutable image contains OpenSSL
# 3.5.6-r0; upgrade only its runtime libraries to Alpine's exact patched v3.22
# release before any application layer is built.
RUN test "$(bun --version)" = "1.3.14"
RUN apk add --no-cache \
      "libcrypto3=${OPENSSL_VERSION}" \
      "libssl3=${OPENSSL_VERSION}"
RUN apk info -vv | grep -q '^musl-1.2.5-r12 - '
RUN apk info -vv | grep -q "^libcrypto3-${OPENSSL_VERSION} - "
RUN apk info -vv | grep -q "^libssl3-${OPENSSL_VERSION} - "
RUN apk info -vv | grep -q '^ca-certificates-bundle-20260413-r0 - '
RUN ! apk info -e glibc
RUN ! apk info -e perl
RUN ! apk info -e sqlite-libs
RUN ! apk info -e openssl

FROM base AS deps
WORKDIR /app
# Root manifest plus the dashboard workspace manifest needed for resolution.
COPY package.json bun.lock ./
COPY dashboard/package.json ./dashboard/package.json
RUN bun install --frozen-lockfile --ignore-scripts

FROM base AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY scripts ./scripts
RUN bun run build:server

FROM base AS runner
ARG BASH_VERSION
WORKDIR /app
# Preserve the reviewed bash runtime boundary. Git and tmux remain absent.
RUN apk add --no-cache "bash=${BASH_VERSION}" \
    && apk info -vv | grep -q "^bash-${BASH_VERSION} - " \
    && ! command -v git \
    && ! command -v tmux
ENV NODE_ENV=production \
    TODOS_NO_OPEN=true
COPY --from=build /app/dist ./dist
# Stage A containment-only: no listener, datastore, schema operation, or
# provider command is started by this image. A later reviewed stage must define
# a separate operational contract and health policy.
HEALTHCHECK NONE
CMD ["bun", "dist/server/index.js", "--help"]
