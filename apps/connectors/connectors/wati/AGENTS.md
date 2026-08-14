# AGENTS.md

WATI WhatsApp Business API connector — CLI and TypeScript library.

## Build

```bash
bun install && bun run typecheck && bun test
```

## Auth

- `WATI_API_KEY` — Bearer token
- `WATI_BASE_URL` — Required tenant URL (no default)

## Structure

```
src/api/     — client + resource modules
src/cli/     — commander CLI (22 operations)
src/types/   — TypeScript interfaces
src/utils/   — config + output
```

## Security

- No hardcoded secrets
- No browser-use dependency
- Placeholder-only `.env.example`
