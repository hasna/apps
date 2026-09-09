# Self-host intake only. Owner initialization and durable PostgreSQL are external.
FROM oven/bun:1.3.14 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY src ./src
COPY schemas ./schemas
RUN bun build src/server/serve-entry.ts --outfile /app/intake.js --target bun --external pg --external @hasna/contracts/*

FROM oven/bun:1.3.14
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/intake.js ./intake.js
USER bun
ENV HOST=0.0.0.0 PORT=3000
EXPOSE 3000
ENTRYPOINT ["bun","--no-env-file","/app/intake.js"]
