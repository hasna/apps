ARG APP_IMAGE
FROM ${APP_IMAGE}
USER root
# The deployment-only layer is not part of the public npm artifact. A full
# PostgreSQL custom-format dump includes schema, all tables, history and ACLs.
RUN apk add --no-cache postgresql17-client && mkdir -p /app/deployment && chmod 0755 /app/deployment
COPY --chmod=0644 tooling/deploy/knowledge/database-phase.mjs /app/deployment/database-phase.mjs
USER bun
