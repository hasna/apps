# conversations-serve — ARM64 / Bun runtime image for the HTTP API service.
# The serve process reads/writes Postgres selected by
# HASNA_CONVERSATIONS_DATABASE_URL. No SQLite, no local state.
#
# Base image: the official oven/bun Alpine image, pinned by multi-arch index
# digest, in lockstep with the deploy-todos / deploy-skills / deploy-projects
# lanes. It replaces public.ecr.aws/docker/library/debian:bookworm-slim, whose
# Debian OS layer could never clear this lane's local vulnerability gate
# (BUG-0067): the gate rejected every candidate with critical=4, high=67, and
# Trivy attributed all four criticals and 63 of the 67 highs to Debian packages
# that ship no fix at all in bookworm — perl-base (CVE-2026-13221,
# CVE-2026-42496, CVE-2026-8376), zlib1g (CVE-2023-45853, will_not_fix), and the
# util-linux/mount/bsdutils, ncurses, libacl, libldap, libsystemd and curl
# groups. Trivy reported FixedVersion "none" for every one of them, so no
# apt-get upgrade could ever clear them: with `ignore-unfixed: false` and a gate
# that rejects any critical or high, no Debian-based conversations image could
# ever deploy. Alpine is the fleet's clean baseline — this exact pinned image
# already passes that gate for todos, skills and projects.
#
# Pinning the digest also removes the `curl | bash` Bun installer the Debian
# image needed, so the toolchain arrives as an immutable image layer instead of
# a script piped from bun.sh during the build.
ARG BUN_IMAGE=oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0
ARG BUN_VERSION=1.3.14

FROM ${BUN_IMAGE} AS base
ARG BUN_VERSION
WORKDIR /app

# ---- bun runtime ----
# Bun ships in the base image, built against musl. Assert the musl boundary, the
# exact Bun version the deploy lane checks against the shipped artefact (it
# greps `ARG BUN_VERSION` out of this file), and the absence of the Debian-only
# packages that produced BUG-0067's criticals — so an accidental base-image or
# digest change fails here, at build time, rather than at the vulnerability gate
# with production credentials already staged.
RUN test "$(bun --version)" = "${BUN_VERSION}"
RUN ! apk info -e glibc
RUN ! apk info -e perl

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
# with "self signed certificate in certificate chain" (I38-00558).
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
