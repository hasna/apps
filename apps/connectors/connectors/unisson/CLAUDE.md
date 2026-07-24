# CLAUDE.md

Unisson Runner API connector (`connect-unisson`).

## Commands

```bash
bun install
bun run dev
bun run typecheck
bun test
```

## Authentication

Bearer token via `UNISSON_API_KEY` or profile config at `~/.hasna/connectors/connect-unisson/`.

Default base URL: `https://api.unisson.ai/v1`

## API Resources

- `agents` — list, get, create product expert agents
- `tasks` — list, get, create customer tasks
- `knowledge` — list articles, sync knowledge base
- `raw-request` — arbitrary API paths
