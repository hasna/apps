ARG APP_IMAGE
FROM ${APP_IMAGE}
USER root
# The deployment-only layer is not part of the public npm artifact. A full
# PostgreSQL custom-format dump includes schema, all tables, history and ACLs.
# The pinned Bun image contains older OpenSSL libraries. Require Alpine's
# patched runtime libraries before the production vulnerability gate.
RUN apk add --no-cache postgresql17-client 'libcrypto3>=3.5.8-r0' 'libssl3>=3.5.8-r0' \
    && mkdir -p /app/deployment && chmod 0755 /app/deployment
COPY --chmod=0644 tooling/deploy/knowledge/database-phase.mjs tooling/deploy/knowledge/reviewed-migrations.json /app/deployment/
USER bun
