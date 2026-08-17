# @hasna/prompts — self-host deployment artifact (prompts-serve).
# The server selects PostgreSQL via HASNA_PROMPTS_DATABASE_URL and bodies via
# HASNA_PROMPTS_S3_BUCKET/HASNA_PROMPTS_BODY_PATH. The API signing secret is
# HASNA_PROMPTS_API_SIGNING_KEY. Never bake credentials into this image.
# The package is a member of the hasna/apps bun workspace, so the build runs
# from the workspace root with the root lockfile.
FROM oven/bun:1.3.14 AS build
WORKDIR /repo
COPY package.json bun.lock ./
COPY apps/prompts/package.json apps/prompts/package.json
COPY apps/prompts/bun.lock apps/prompts/bun.lock
RUN bun install --frozen-lockfile
COPY apps/prompts ./apps/prompts
WORKDIR /repo/apps/prompts
RUN bun run build

FROM oven/bun:1.3.14
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/apps/prompts/package.json /repo/apps/prompts/bun.lock ./
COPY --from=build /repo/apps/prompts/dist ./dist
COPY --from=build /repo/apps/prompts/openapi.json ./openapi.json
COPY --from=build /repo/apps/prompts/node_modules ./node_modules
COPY --from=build /repo/apps/prompts/scripts ./scripts
EXPOSE 19430
# Migrations are a separate owner-role step (scripts/apply-postgres-migrations.mjs);
# the container runs the service with a DML-only app role.
CMD ["bun", "run", "dist/server/index.js"]
