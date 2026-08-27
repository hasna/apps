# conversations-serve — ARM64 / Bun runtime image for the HTTP API service.
# The serve process reads/writes Postgres selected by
# HASNA_CONVERSATIONS_DATABASE_URL. No SQLite, no local state.
#
# Base image: AWS's credential-free ECR Public mirror of the Debian Official
# Image, with a pinned Bun installed via the official installer. oven/bun:1 is
# itself Debian-based, so this is functionally equivalent — but it avoids
# docker.io, whose anonymous pull rate limit (HTTP 429) reliably fails the
# shared-IP CodeBuild fleet builder.
FROM public.ecr.aws/docker/library/debian:bookworm-slim AS base
WORKDIR /app

# ---- bun runtime ----
ENV BUN_INSTALL=/usr/local/bun
ENV PATH=$BUN_INSTALL/bin:$PATH
ARG BUN_VERSION=1.3.13
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl unzip ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}" \
 && bun --version

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
