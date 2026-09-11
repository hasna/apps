# conversations-serve — ARM64 / Bun runtime image for the HTTP API service.
# The serve process reads/writes Postgres selected by
# HASNA_CONVERSATIONS_DATABASE_URL. No SQLite, no local state.
#
# Base image: the officially published Bun Alpine image, pinned to the
# multi-arch image INDEX digest (application/vnd.oci.image.index.v1+json) rather
# than to one platform's manifest. This lane builds native linux/arm64, and the
# amd64 manifest digest (efc5e42c…, the one apps/todos pins for its amd64 build)
# pulls the wrong architecture and dies on the first RUN with "exec format
# error". Index 5acc90a9… resolves to
#   linux/amd64 efc5e42c7bedc1661ab0b7272c74c3ebf794f054297f530a62055f2d1a0eb662
#   linux/arm64 3c9ab1a521c82144dff537125695017a0480d3a13088fba7e012cfae0f63146f
#
# Why this image no longer builds FROM the Debian base it used to (the ECR
# Public mirror of debian:bookworm-slim, originally chosen because docker.io's
# anonymous pull rate limit — HTTP 429 — reliably failed the shared-IP CodeBuild
# fleet builder): that base can never pass this lane's own vulnerability gate.
# The gate (.github/workflows/deploy-conversations.yml, "Enforce local
# vulnerability gate") scans the candidate with trivy at `ignore-unfixed: false`
# and refuses ANY CRITICAL or HIGH, and bookworm carries findings the Debian
# security tracker has already closed as unfixed — perl-base CVE-2026-13221,
# CVE-2026-42496 and CVE-2026-8376 plus zlib1g CVE-2023-45853 (4 CRITICAL), and
# ~60 unfixed HIGH across perl-base, libcurl4/libcurl, util-linux, ncurses and
# gzip. Measured on run 34472713399 at 43dcf63b: the gate rejected the candidate
# with critical=4, high=67, and every one of those 67 OS findings was an unfixed
# bookworm base package — none of them an app dependency, and none of them
# clearable by a rebuild, a pin or a base-image refresh. The lane could
# therefore not ship ANY merged conversations change; BUG-0062's merged fix
# stayed off production (BUG-0067). The gate was NOT weakened to unblock it —
# the base was remediated.
#
# Alpine is the same hardened base the passing deploy lanes already use
# (deploy-todos, deploy-skills, deploy-projects): it ships no perl, no curl and
# no util-linux, and a zlib 1.3.2-r0 that already carries the CVE-2023-45853
# fix, so the unfixed bookworm class does not exist here. Nothing in the runtime
# needs glibc: the service is bun plus pure-JS dependencies (pg, zod, commander,
# ink, the MCP SDK). The two HIGHs this base does carry — libcrypto3/libssl3
# 3.5.6-r0, CVE-2026-45447 and CVE-2026-14456 — are closed by pinning Alpine's
# patched 3.5.8-r0 below, exactly as apps/todos and apps/skills do.
ARG BUN_IMAGE=oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0
ARG BUN_VERSION=1.3.14
ARG OPENSSL_VERSION=3.5.8-r0

FROM ${BUN_IMAGE} AS base
WORKDIR /app

# The shipped runtime must be the Bun this file pins, not whatever the tag
# happens to hold: the lane's "Verify shipped runtime and package version" step
# greps this ARG out of this file and requires the running bun to equal it.
ARG BUN_VERSION
RUN test "$(bun --version)" = "${BUN_VERSION}"

# ---- runtime packages ----
# Only the two OpenSSL runtime libraries are upgraded, to Alpine's exact patched
# build, and the result is asserted rather than assumed: a silently older
# package is precisely what the scan gate would reject an hour later. The
# negative assertions pin the boundary this migration exists to hold — no glibc,
# no perl, no util-linux — so a base-image or repository change that
# reintroduces the rejected class fails the build here instead of failing the
# gate after AWS auth.
ARG OPENSSL_VERSION
RUN apk add --no-cache \
      "libcrypto3=${OPENSSL_VERSION}" \
      "libssl3=${OPENSSL_VERSION}" \
 && apk info -vv | grep -q "^libcrypto3-${OPENSSL_VERSION} - " \
 && apk info -vv | grep -q "^libssl3-${OPENSSL_VERSION} - " \
 && apk info -vv | grep -q '^musl-1.2.5-r12 - ' \
 && apk info -vv | grep -q '^ca-certificates-bundle-20260413-r0 - ' \
 && ! apk info -e glibc \
 && ! apk info -e perl \
 && ! apk info -e util-linux

# ---- deps (cached) ----
# --ignore-scripts: the postinstall only pre-creates the host ~/.hasna/conversations
# data home (and its `training` subdir), which a container does not use — this
# image is Postgres-only, no local state, and the runtime getDataDir() creates
# the same directories on first use. Running it here would fail the build:
# postinstall.js is not copied into this layer.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

# ---- source ----
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY hasna.contract.json ./

# Bind the runtime response and OCI metadata to the source used for this image.
# This is generated into executable source now; no deploy-time environment
# variable can change it without building and shipping a different artifact.
ARG BUILD_SHA=""
ARG REQUIRE_BUILD_SHA=0
LABEL org.opencontainers.image.revision="${BUILD_SHA}"
RUN bun run scripts/ci/render-build-sha.ts "$BUILD_SHA" src/server/build-sha.generated.ts "$REQUIRE_BUILD_SHA"

# Amazon RDS global CA bundle so TLS to the shared RDS succeeds: the vendored
# storage kit verifies the server certificate under sslmode=require and falls
# back to Node's default trust store when no CA is supplied — the RDS root is
# not in it, so both serve and the one-shot migrate task fail the handshake
# with "self signed certificate in certificate chain" (I38-00558). Alpine's
# ca-certificates-bundle already provides /etc/ssl/certs/ca-certificates.crt,
# so this only adds the RDS root alongside the system store.
COPY docker/rds-global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem \
    PGSSLROOTCERT=/etc/ssl/certs/rds-global-bundle.pem

EXPOSE 8080

# Liveness: the ALB target group also hits /health.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Default: run the API server. The one-shot migration task overrides this with
# ["bun","run","src/server/migrate.ts"].
CMD ["bun", "run", "src/server/serve-entry.ts"]
