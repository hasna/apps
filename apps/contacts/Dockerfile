# syntax=docker/dockerfile:1
# @hasna/contacts self_hosted service — ARM64 / Bun.
# Default CMD runs contacts-serve (cloud / PURE REMOTE per Amendment A1: the
# serve process reads/writes RDS Postgres directly with @hasna/contracts API-key
# auth). The ECS one-shot migration task overrides the command with `… migrate`.

ARG BUN_IMAGE=oven/bun:1.3.14-alpine@sha256:3c9ab1a521c82144dff537125695017a0480d3a13088fba7e012cfae0f63146f

FROM --platform=linux/arm64 ${BUN_IMAGE} AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts \
    && install -d -m 700 -o 65532 -g 65532 /runtime-home

FROM --platform=linux/arm64 ${BUN_IMAGE} AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY scripts ./scripts
COPY vendor ./vendor
RUN bun run scripts/build-bundles.ts --standalone-server

FROM scratch AS runner
WORKDIR /app
# Minimal ARM64 runtime: Bun is not dynamically linked to OpenSSL. Copy only
# its musl/C++ runtime libraries and public CA roots instead of Alpine's package
# manager and unused OpenSSL libraries.
COPY --from=deps /usr/local/bin/bun /usr/local/bin/bun
COPY --from=deps /lib/ld-musl-aarch64.so.1 /lib/ld-musl-aarch64.so.1
COPY --from=deps /lib/libc.musl-aarch64.so.1 /lib/libc.musl-aarch64.so.1
COPY --from=deps /usr/lib/libgcc_s.so.1 /usr/lib/libgcc_s.so.1
COPY --from=deps /usr/lib/libstdc++.so.6 /usr/lib/libstdc++.so.6
COPY --from=deps /usr/lib/libstdc++.so.6.0.33 /usr/lib/libstdc++.so.6.0.33
COPY --from=deps /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
# Amazon RDS global CA bundle so TLS to the shared RDS succeeds even for
# verify-full-capable clients.
COPY docker/rds-global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
COPY --from=deps --chown=65532:65532 /runtime-home /home/nonroot
ENV PATH=/usr/local/bin \
    HOME=/home/nonroot \
    NODE_ENV=production \
    HASNA_CONTACTS_STORAGE_MODE=cloud \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem \
    PGSSLROOTCERT=/etc/ssl/certs/rds-global-bundle.pem \
    CONTACTS_NO_OPEN=true \
    CONTACTS_HOST=0.0.0.0 \
    HOST=0.0.0.0 \
    PORT=19428
COPY package.json ./package.json
COPY --from=build /app/dist ./dist
EXPOSE 19428
# The server only needs the unprivileged high port and read-only application
# files; use the conventional numeric non-root identity supported by scratch.
USER 65532:65532
# Fail-closed: contacts-serve /v1 refuses to serve without a cloud DSN + signing
# secret (503), and /ready reports DB reachability — no silent stub.
CMD ["/usr/local/bin/bun", "--no-install", "dist/server/cloud-index.js"]
