# CLAUDE.md

Testmo connector — Bearer API key auth against the Testmo REST API.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test src/api/client.test.ts
```

## Authentication

Bearer token via `TESTMO_API_KEY` or profile config at `~/.hasna/connectors/testmo/`.

Optional `TESTMO_BASE_URL` for instance URLs (`https://{instance}.testmo.net/api/v1`).

## API surface

- `listRuns`, `createRun`, `getRun`
- `listEvents`
- `search`
- `rawRequest`

Default base URL: `https://api.testmo.net/v1`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TESTMO_API_KEY` | API key |
| `TESTMO_BASE_URL` | Optional base URL override |
