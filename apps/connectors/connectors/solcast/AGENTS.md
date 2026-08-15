# AGENTS.md

Solcast API connector for solar PV forecasts and estimated actuals.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
```

## Structure

```
src/
|-- api/client.ts   # HTTP client (api_key query auth)
|-- api/solcast.ts  # Endpoint methods
|-- cli/index.ts    # Commander CLI
|-- types/index.ts
`-- utils/config.ts
```

## Environment

| Variable | Description |
|----------|-------------|
| `SOLCAST_API_KEY` | API key |
| `SOLCAST_BASE_URL` | Optional base URL override |
