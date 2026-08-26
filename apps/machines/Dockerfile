# =============================================================================
# @hasna/machines control-plane serve — ARM64 / Bun image
# =============================================================================
# Multi-stage: install + build with the full toolchain, then a slim runtime that
# ships dist/ + node_modules (build externalizes @hasna/*, pg, and the MCP SDK,
# so they must be present at runtime). Runs machines-serve by default; the ECS
# migration task overrides the command with `bun dist/cli/index.js db migrate`.

FROM --platform=linux/arm64 oven/bun:1.2 AS build
WORKDIR /app
COPY package.json bun.lock ./
# I38-00554: skip lifecycle scripts here — `prepare` ("bun run build") must not
# run before src/ is copied into this stage. The build runs explicitly below.
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
RUN bun run build

FROM --platform=linux/arm64 oven/bun:1.2-slim AS runtime
WORKDIR /app
# Amazon RDS global CA bundle so verify-full-capable TLS to the shared RDS
# succeeds (pg-connection-string escalates sslmode=require to verify-full).
COPY docker/rds-global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem \
    PGSSLROOTCERT=/etc/ssl/certs/rds-global-bundle.pem
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/schemas ./schemas
COPY --from=build /app/package.json ./package.json

EXPOSE 8080

# Lightweight in-container healthcheck against the liveness probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "dist/server/index.js"]
