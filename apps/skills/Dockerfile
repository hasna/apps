FROM oven/bun:1.3.14-slim AS deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
# O15-00677: skip lifecycle scripts here — `prepare` ("bun run build:js") must
# not run before src/ is copied into this stage (it fails with FileNotFound on
# "./src/"). The build runs explicitly in the build stage below, where src/
# exists.
RUN bun install --ignore-scripts --frozen-lockfile

FROM deps AS build
COPY . .
RUN bun run build

FROM oven/bun:1.3.14-slim AS runtime
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
