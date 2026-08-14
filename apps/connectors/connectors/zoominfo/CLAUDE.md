# CLAUDE.md

See `AGENTS.md` for connector-specific instructions.

## Authentication

ZoomInfo uses username/password authentication via `POST /authenticate` to obtain a Bearer JWT token. Preconfigured JWT tokens are also supported via `ZOOMINFO_JWT` or `connect-zoominfo config set-jwt`.

Subsequent API calls use `Authorization: Bearer <jwt>`.

Environment variables:

| Variable | Description |
|----------|-------------|
| `ZOOMINFO_USERNAME` | ZoomInfo API username |
| `ZOOMINFO_PASSWORD` | ZoomInfo API password |
| `ZOOMINFO_JWT` | Preconfigured Bearer JWT (skips /authenticate) |
| `ZOOMINFO_BASE_URL` | Override API base URL |

JWT tokens expire after approximately 60 minutes. Long-running processes should re-authenticate or refresh the configured JWT.
