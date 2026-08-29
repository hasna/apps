# syntax=docker/dockerfile:1
# Local/dev image: builds from source in this repo, then runs secrets-serve.
# Production images are built from the published npm tarball via Dockerfile.package.

FROM oven/bun:1.3.14-alpine AS build
WORKDIR /app
COPY package.json bun.lock postinstall.js ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.3.14-alpine AS runtime
ENV NODE_ENV=production \
    HASNA_APP_NAME=secrets \
    HASNA_APP_MODE=self_hosted \
    HASNA_SECRETS_STORAGE_MODE=cloud \
    PORT=8080 \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem \
    PGSSLROOTCERT=/etc/ssl/certs/rds-global-bundle.pem
WORKDIR /app
RUN apk add --no-cache ca-certificates curl \
  && curl -fsSL -o /etc/ssl/certs/rds-global-bundle.pem \
       https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
  && addgroup -g 10001 -S secrets \
  && adduser -S -D -H -u 10001 -G secrets secrets
COPY package.json bun.lock postinstall.js ./
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
RUN bun install --production --frozen-lockfile \
  && chown -R secrets:secrets /app
USER secrets
EXPOSE 8080
CMD ["bun", "dist/server/index.js"]
