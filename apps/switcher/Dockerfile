# syntax=docker/dockerfile:1
# switcher-serve — Bun runtime image for the local SQLite and hosted PostgreSQL APIs.

FROM --platform=linux/arm64 oven/bun:1.3.14-alpine AS builder
RUN apk upgrade --no-cache \
 && test "$(bun --version)" = "1.3.14"
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json openapi.json hasna.contract.json ./
COPY scripts ./scripts
COPY src ./src
RUN bun run generate \
 && bun run build

FROM --platform=linux/arm64 oven/bun:1.3.14-alpine AS runtime
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
RUN apk upgrade --no-cache \
 && apk add --no-cache ca-certificates wget \
 && test "$(bun --version)" = "1.3.14" \
 && wget -qO /app/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
 && mkdir /data \
 && chown bun:bun /data
ENV NODE_EXTRA_CA_CERTS=/app/rds-global-bundle.pem \
    PGSSLROOTCERT=/app/rds-global-bundle.pem
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/openapi.json ./openapi.json
COPY --from=builder /app/hasna.contract.json ./hasna.contract.json
RUN printf '#!/bin/sh\nexec bun /app/dist/serve/index.js "$@"\n' > /usr/local/bin/switcher-serve \
 && printf '#!/bin/sh\nexec bun /app/dist/mint/index.js "$@"\n' > /usr/local/bin/switcher-mint-key \
 && chmod +x /usr/local/bin/switcher-serve /usr/local/bin/switcher-mint-key
USER bun
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e 'fetch("http://127.0.0.1:8080/ready").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'
CMD ["switcher-serve", "--host", "0.0.0.0"]
