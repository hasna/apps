FROM oven/bun:1.3.13-slim AS deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

FROM deps AS build
COPY . .
RUN bun run build

FROM oven/bun:1.3.13-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/bin ./bin
COPY --from=build /app/dist ./dist
COPY package.json ./
# Corpus-free by contract: the runtime image carries NO skill corpus
# (neither ./skills nor ./agent-skills). Bundles are fetched by digest
# from the registry at run time.
COPY migrations ./migrations
EXPOSE 8787
CMD ["bun", "bin/server.js"]
