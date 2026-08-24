# Self-host deployment artifact for @hasna/messages (messages-serve).
# Build the four surfaces, then run the HTTP API in a minimal bun image.
FROM oven/bun:1.3.14 AS build
WORKDIR /app
COPY package.json bun.lock* ./
COPY apps/messages/package.json ./apps/messages/
RUN bun install --frozen-lockfile --ignore-scripts
COPY apps/messages ./apps/messages
RUN cd apps/messages && bun run build

FROM oven/bun:1.3.14
WORKDIR /app
COPY --from=build /app/apps/messages/bin ./bin
COPY --from=build /app/apps/messages/dist ./dist
COPY --from=build /app/apps/messages/package.json ./package.json
ENV HASNA_MESSAGES_PORT=8081
EXPOSE 8081
CMD ["bun", "bin/serve.js"]
