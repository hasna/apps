# Self-host deployment artifact for @hasna/messages (messages-serve).
# Build the four surfaces, then run the HTTP API in a minimal bun image.
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

FROM oven/bun:1.3.14
WORKDIR /app
COPY --from=build /app/bin ./bin
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
# Amazon RDS global CA bundle (public AWS artifact) so the pg TLS connection
# to the harness RDS verifies the server certificate (sslmode=require).
# (oven/bun has no wget; bun's fetch does the download.)
RUN bun -e "const r = await fetch('https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem'); if (!r.ok) throw new Error('bundle fetch ' + r.status); await Bun.write('/etc/ssl/certs/rds-global-bundle.pem', await r.arrayBuffer());" \
  && chmod 644 /etc/ssl/certs/rds-global-bundle.pem
ENV HASNA_MESSAGES_PORT=8081 \
    HASNA_MESSAGES_HOST=0.0.0.0
EXPOSE 8081
CMD ["bun", "bin/serve.js"]
