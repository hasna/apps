# Self-host deployment artifact for @hasna/messages (messages-serve).
# Build the four surfaces, then run the HTTP API with Bun and its runtime libraries.
# Build context = apps/messages/ (the app's own package.json + bun.lock,
# matching the notes/emails deploy lanes — the repo-root workspace is NOT
# copied into the image).
FROM oven/bun:1.3.14 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY src ./src
COPY scripts ./scripts
COPY tsconfig.json tsconfig.build.json ./
RUN bun run build

# Amazon RDS global CA bundle (public AWS artifact) so the pg TLS connection
# verifies the server certificate. Fetch at build time; runtime has no shell.
RUN bun -e "const r = await fetch('https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem'); if (!r.ok) throw new Error('bundle fetch ' + r.status); await Bun.write('/etc/ssl/certs/rds-global-bundle.pem', await r.arrayBuffer());" \
  && chmod 644 /etc/ssl/certs/rds-global-bundle.pem

# Bun's official distroless image uses this same Debian runtime family. Keep
# the Bun version pinned above while updating the runtime OS independently.
# Bun supplies TLS and SQLite itself; no system OpenSSL, zlib or SQLite is
# needed. Retain the base image's OS/package metadata for vulnerability scans.
FROM gcr.io/distroless/base-nossl-debian13:nonroot@sha256:8c563c1fb5e120606f0d85733049775faed6192e2bd2223ef283a5393eec22b9
WORKDIR /app
COPY --from=build /usr/local/bin/bun /usr/local/bin/bun
COPY --from=build /app/bin ./bin
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /etc/ssl/certs/rds-global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
ENV HASNA_MESSAGES_PORT=8081 \
    HASNA_MESSAGES_HOST=0.0.0.0 \
    HOME=/home/nonroot \
    BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
EXPOSE 8081
CMD ["bun", "bin/serve.js"]
