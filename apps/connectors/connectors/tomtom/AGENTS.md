# AGENTS.md

TomTom maps and routing connector for the connectors monorepo.

## Commands

```bash
bun install
bun run dev
bun run build
```

## Structure

- `src/api/index.ts` — TomTom REST client
- `src/cli/index.ts` — CLI commands
- `src/utils/config.ts` — API key storage at `~/.hasna/connectors/connect-tomtom/`

## Auth

API key only. Env: `TOMTOM_API_KEY`.

## No browser-use

Uses TomTom public REST APIs only.
