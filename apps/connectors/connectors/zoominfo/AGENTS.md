# AGENTS.md

Guidance for AI agents working on this connector.

## Scope

This package implements `@hasna/connect-zoominfo`, a real ZoomInfo B2B sales intelligence REST API connector. Keep it on documented ZoomInfo HTTP endpoints and do not add browser automation dependencies.

## API Model

- Default base URL: `https://api.zoominfo.com`
- Authentication: `POST /authenticate` with username/password returns a JWT, or use a preconfigured JWT via `ZOOMINFO_JWT`
- Subsequent requests use `Authorization: Bearer <jwt>`
- Raw requests must use relative paths without `..` traversal
- Keep `.env.example` values as placeholders only

## Checks

Before finishing changes:

```bash
bun run typecheck
bun run build
```

Also scan for committed secrets, internal references, and browser automation dependencies.
