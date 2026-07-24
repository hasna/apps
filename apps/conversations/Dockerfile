# conversations-serve — ARM64 / Bun runtime image for the self_hosted service.
# PURE REMOTE (Amendment A1): the serve process talks to the shared cloud
# Postgres directly. No SQLite, no local state.
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
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# ---- source ----
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY hasna.contract.json ./

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    HASNA_CONVERSATIONS_STORAGE_MODE=cloud

EXPOSE 8080

# Liveness: the ALB target group also hits /health.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Default: run the API server. The one-shot migration task overrides this with
# ["bun","run","src/server/migrate.ts"].
CMD ["bun", "run", "src/server/serve-entry.ts"]
