# syntax=docker/dockerfile:1
FROM --platform=linux/arm64 oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS build
WORKDIR /app
COPY package.json bun.lock bunfig.toml tsconfig.json ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY src ./src
COPY scripts ./scripts
RUN bun run build

FROM --platform=linux/arm64 oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS runtime
RUN apk add --no-cache "libcrypto3=3.5.8-r0" "libssl3=3.5.8-r0"
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile --production --ignore-scripts
COPY --from=build /app/dist ./dist
COPY --from=build /app/openapi.json ./openapi.json
COPY docker/rds-global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
ENV NODE_ENV=production PORT=8080 \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem \
    PGSSLROOTCERT=/etc/ssl/certs/rds-global-bundle.pem
USER bun
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e 'fetch("http://127.0.0.1:8080/ready").then(async r=>{const b=await r.json();process.exit(r.ok&&b.status==="ready"?0:1)}).catch(()=>process.exit(1))'
CMD ["bun", "dist/serve/index.js", "--host", "0.0.0.0"]
