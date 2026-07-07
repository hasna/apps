# AGENTS.md

## Project Overview

connect-twitch is a TypeScript connector for the Twitch Helix API with OAuth2 authentication and multi-profile configuration.

## Build & Run

```bash
bun install
bun run dev
bun run build
bun run typecheck
```

## Authentication

OAuth authentication. Credentials via environment variables or profile config:

- `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`
- `TWITCH_ACCESS_TOKEN`, `TWITCH_REFRESH_TOKEN`
- OAuth flow: `connect-twitch auth login`

## Structure

```
src/
├── api/       # Helix client + resource modules
├── cli/       # Commander CLI
├── types/
├── utils/     # config, output
└── index.ts
```

## Dependencies

commander, chalk only.
