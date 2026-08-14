# AGENTS.md

TypeScript connector for TikTok Events API 2.0. ESM, commander + chalk only.

## Structure

```
src/api/     client, events, pixels, offline, crm
src/cli/     CLI entry
src/types/   shared types
src/utils/   config, output
```

## Patterns

- SHA-256 hash `email`, `phone`, `external_id` before sending
- Merge legacy `context.user/ip/user_agent` into event user
- `raw-request` must reject URLs outside configured TikTok Business API origin
- Profile config at `~/.hasna/connectors/connect-tiktok-events-api/`

## Commands

```bash
bun run dev
bun run typecheck
bun run build
bun test
```
