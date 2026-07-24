# CLAUDE.md

Wordfence API Platform connector for Wordfence Intelligence v3 vulnerability feed.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Auth

Bearer token via `WORDFENCE_API_PLATFORM_API_KEY` or profile `config set-key`.

Default API base: `https://www.wordfence.com/api/intelligence/v3`

Primary endpoint: `GET /vulnerabilities/production`

## CLI

- `items list|get|create` — vulnerability feed (create is read-only error)
- `events list` — recently published vulnerabilities
- `search` — filter feed by text/CVE/plugin slug
- `raw` — authenticated raw request

Profiles: `~/.hasna/connectors/connect-wordfence-api-platform/profiles/`
