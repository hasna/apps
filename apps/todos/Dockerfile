# @hasna/todos self_hosted service — ARM64 / Bun.
# Default CMD runs todos-serve (cloud / PURE REMOTE per Amendment A1: the serve
# process reads/writes RDS Postgres directly with @hasna/contracts API-key auth).
# The ECS one-shot migration task overrides the command with `... migrate`.

ARG BUN_IMAGE=oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0
ARG BASH_VERSION=5.2.37-r0
ARG OPENSSL_VERSION=3.5.8-r0

FROM ${BUN_IMAGE} AS base
ARG OPENSSL_VERSION
# Base pinned to the multi-arch image INDEX (application/vnd.oci.image.index.v1+json),
# never to one platform's manifest. This lane builds native linux/arm64
# (deploy-todos.yml runs `--platform linux/arm64` on ubuntu-24.04-arm, and the
# buildspec candidate gate builds `--platform linux/arm64` too), and an index
# digest is what lets buildx resolve the manifest matching the platform it was
# asked to build. The previous pin was the linux/amd64 child manifest
# (efc5e42c…): the arm64 build pulled amd64 layers, and after buildkit warned
# `was pulled with platform "linux/amd64", expected "linux/arm64"` the first RUN
# died with `exec /bin/sh: exec format error`. Index 5acc90a9… (verified against
# registry-1.docker.io) resolves to
#   linux/amd64 efc5e42c7bedc1661ab0b7272c74c3ebf794f054297f530a62055f2d1a0eb662
#   linux/arm64 3c9ab1a521c82144dff537125695017a0480d3a13088fba7e012cfae0f63146f
# so the amd64 child stays reachable for amd64 builds, and this is the pin
# apps/skills and apps/loops already carry. Assert the musl boundary and the
# immutable base's security-relevant package floor so an accidental digest or
# platform change fails during the build. The official immutable image contains
# OpenSSL 3.5.6-r0; upgrade only its runtime libraries to Alpine's exact patched
# v3.22 release before any application layer is built.
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
# Root manifest + workspace member manifests (needed for the workspace to
# resolve; the workspaces themselves are not built in the server image).
COPY package.json bun.lock ./
COPY ai/package.json ./ai/package.json
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
# The previous Debian runtime included bash, and the bundled event-hook and
# agent-run paths invoke bash explicitly. Preserve that supported boundary with
# one exact Alpine package; git and tmux were not present in the predecessor
# image and remain intentionally outside the cloud container contract.
RUN apk add --no-cache "bash=${BASH_VERSION}" \
    && apk info -vv | grep -q "^bash-${BASH_VERSION} - " \
    && ! command -v git \
    && ! command -v tmux
# Amazon RDS global CA bundle so TLS to the shared RDS succeeds even under
# verify-full-capable clients.
COPY docker/rds-global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
ENV NODE_ENV=production \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem \
    PGSSLROOTCERT=/etc/ssl/certs/rds-global-bundle.pem \
    HOST=0.0.0.0 \
    PORT=19427
COPY --from=build /app/dist ./dist
# Disable Bun's runtime auto-install. Without it, a bare specifier left in the
# bundle is fetched from the public npm registry at the `latest` tag on every
# container start, ignoring bun.lock — which is how a contracts release broke
# this image on 2026-08-01. See docker/runner-bunfig.toml for the full account.
COPY docker/runner-bunfig.toml ./bunfig.toml
# The server bundle is self-contained: dist/server/index.js resolves nothing but
# Bun and Node builtins, which src/server-bundle-self-contained.test.ts asserts
# against this exact filesystem shape. Keep only the standalone, pre-bundled
# contracts CLI used to mint the ephemeral API key during controlled smoke and
# operational workflows; do not ship the workspace dependency tree.
COPY --from=deps /app/node_modules/@hasna/contracts/dist/cli/index.js ./bin/contracts-cli.js
EXPOSE 19427
# Fail-closed: todos-serve /v1 refuses to serve without a cloud DSN + signing
# secret (503), and /ready reports DB reachability — no silent stub.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["bun", "-e", "const response = await fetch('http://127.0.0.1:19427/ready'); if (!response.ok) process.exit(1);"]
CMD ["bun", "dist/server/index.js"]
