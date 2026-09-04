# Runtime image for the hosted skills service (API, worker, and the one-off migration task).
#
# Alpine, pinned by digest, like apps/todos and the other lanes that pass the deploy scan:
# the Debian `-slim` variant this used to build FROM carries dozens of CRITICAL/HIGH OS
# findings with no patched package (perl-base, util-linux, ncurses), and the deploy lane
# refuses any candidate with a single CRITICAL or HIGH (ignore-unfixed is off), so no
# amount of app-side care could get a Debian image through. Alpine 3.22 has none unfixed;
# the two HIGH findings it does carry (libssl3/libcrypto3 3.5.6-r0, CVE-2026-45447 and
# CVE-2026-14456) are closed by pinning the patched 3.5.8-r0 below, exactly as todos does.
#
# Nothing here needs glibc: the service is bun + pure-JS dependencies (pg, @aws-sdk,
# @modelcontextprotocol/sdk, ink); bun:sqlite ships inside bun's own musl build.
ARG BUN_IMAGE=oven/bun:1.3.14-alpine@sha256:efc5e42c7bedc1661ab0b7272c74c3ebf794f054297f530a62055f2d1a0eb662
ARG OPENSSL_VERSION=3.5.8-r0

FROM ${BUN_IMAGE} AS base
ARG OPENSSL_VERSION
RUN test "$(bun --version)" = "1.3.14"
# Only the two OpenSSL runtime libraries are upgraded, to the exact patched build, and the
# result is asserted rather than assumed: a silently older package is what the scan gate
# would reject an hour later.
RUN apk add --no-cache \
      "libcrypto3=${OPENSSL_VERSION}" \
      "libssl3=${OPENSSL_VERSION}" \
    && apk info -vv | grep -q "^libcrypto3-${OPENSSL_VERSION} - " \
    && apk info -vv | grep -q "^libssl3-${OPENSSL_VERSION} - " \
    && ! apk info -e glibc \
    && ! apk info -e perl

FROM base AS deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --ignore-scripts --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/bin ./bin
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY migrations ./migrations
EXPOSE 8787
CMD ["bun", "bin/server.js"]
