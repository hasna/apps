#!/bin/sh
# =============================================================================
# mementos container entrypoint
# -----------------------------------------------------------------------------
# Bridges the hasna-app Terraform module's injected env (DATABASE_URL,
# API_KEY_SIGNING_SECRET, PORT) to mementos' native env, and binds to all
# interfaces so the ALB target group is reachable. Migrations run against the
# OWNER DSN (DDL); the long-running service runs against the least-privilege
# APP DSN.
# =============================================================================
set -e

# Bind on 0.0.0.0 inside the container (default is 127.0.0.1 for local dev).
export MEMENTOS_HOST="${MEMENTOS_HOST:-0.0.0.0}"

# Amendment A1 — serve/CLI read+write RDS directly.

# Select the DSN by workload: migrations need the owner role (DDL); everything
# else uses the app role. MIGRATION_DATABASE_URL is optional; falls back to
# DATABASE_URL when unset.
case " $* " in
  *" migrate "*)
    export HASNA_MEMENTOS_DATABASE_URL="${HASNA_MEMENTOS_DATABASE_URL:-${MIGRATION_DATABASE_URL:-${DATABASE_URL}}}"
    ;;
  *)
    export HASNA_MEMENTOS_DATABASE_URL="${HASNA_MEMENTOS_DATABASE_URL:-${DATABASE_URL}}"
    ;;
esac

# Contracts auth reads API_KEY_SIGNING_SECRET directly; also expose the
# app-scoped alias for the issuer/CLI.
export HASNA_MEMENTOS_API_SIGNING_KEY="${HASNA_MEMENTOS_API_SIGNING_KEY:-${API_KEY_SIGNING_SECRET}}"

# Map published bin names to their dist entrypoints.
# mementos-deploy is the deploy-lane marker command: the deploy workflow
# (deploy-mementos.yml) registers every managed task definition with
# command=["mementos-deploy"], and preflight verifies the stable baseline by
# that marker. It runs the web server exactly like mementos-serve — without
# this mapping the deployed task would fall through to the fallback branch and
# exec a binary named mementos-deploy that does not exist (O15-05020).
cmd="${1:-mementos-serve}"
[ "$#" -gt 0 ] && shift || true
case "$cmd" in
  mementos-serve) set -- bun /app/dist/server/index.js "$@" ;;
  mementos-deploy) set -- bun /app/dist/server/index.js "$@" ;;
  mementos-mcp)   set -- bun /app/dist/mcp/index.js "$@" ;;
  mementos)       set -- bun /app/dist/cli/index.js "$@" ;;
  bun|/*)         set -- "$cmd" "$@" ;;
  *)              set -- "$cmd" "$@" ;;
esac

exec "$@"
