# AGENTS.md

Veo sports video library connector — list/get videos, transcripts, users, groups.

## Commands

```bash
bun install && bun run typecheck
bun run dev -- videos list
```

## Auth

Bearer token via `VEO_API_KEY` or profile config. Not Google Gemini Veo.

## Structure

- `src/api/client.ts` — HTTP transport
- `src/api/videos.ts`, `users.ts`, `groups.ts` — resource modules
- `src/cli/index.ts` — Commander CLI
