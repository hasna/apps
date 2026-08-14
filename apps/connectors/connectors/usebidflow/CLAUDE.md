# CLAUDE.md

Bidflow Platform API connector for bids, events, and marketplace search.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Project Structure

```
src/
├── api/
│   ├── client.ts
│   ├── bids.ts
│   ├── events.ts
│   └── index.ts
├── cli/
│   └── index.ts
├── types/
│   └── index.ts
├── utils/
│   ├── config.ts
│   └── output.ts
└── index.ts
```

## API

Base URL: `https://api.usebidflow.com/v1`

Endpoints:
- `GET /bids` — list bids
- `POST /bids` — create bid
- `GET /bids/:id` — get bid
- `GET /events` — list events
- `POST /search` — marketplace search

## Authentication

Bearer Token authentication. Credentials can be set via:
- Environment variable `USEBIDFLOW_API_KEY`
- Profile configuration: `connect-usebidflow config set-key <key>`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `USEBIDFLOW_API_KEY` | API key for Bidflow Platform |
| `USEBIDFLOW_BASE_URL` | Optional API base URL override |

## CLI Commands

```bash
connect-usebidflow profile list
connect-usebidflow profile use <name>
connect-usebidflow config set-key <key>
connect-usebidflow config show
connect-usebidflow bids list
connect-usebidflow bids get <bidId>
connect-usebidflow bids create --data '<json>'
connect-usebidflow events list
connect-usebidflow search --query <text>
connect-usebidflow raw --path /bids [--method GET] [--data '<json>']
```

## Data Storage

```
~/.hasna/connectors/connect-usebidflow/
├── current_profile
└── profiles/
    └── default/
        └── config.json
```

## Dependencies

- commander
- chalk
