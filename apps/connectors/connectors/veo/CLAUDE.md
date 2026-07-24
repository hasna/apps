# CLAUDE.md

Veo sports video library API connector (`@hasna/connect-veo`). Distinct from Google Gemini Veo video generation.

## Build & Run

```bash
bun install
bun run dev
bun run typecheck
bun run build
```

## API

Base URL: `https://api.veo.co.uk/api` (override with `VEO_BASE_URL`).

| Command | Endpoint |
|---------|----------|
| `videos list` | `GET /videos/v3/get-all` |
| `videos get <id>` | `GET /videos/{id}` |
| `videos transcript <id>` | `GET /videos/{id}/transcript` |
| `users list` | `GET /users` |
| `groups list` | `GET /groups` |
| `raw-request` | arbitrary path/method |

Public docs: https://developer.veo.co.uk/

## Authentication

Bearer token authentication. Veo's OAuth2 password grant returns an `access_token` — store that value as your API key.

Credentials via:
- `VEO_API_KEY` environment variable
- `connect-veo config set-key <token>`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VEO_API_KEY` | Bearer access token |
| `VEO_BASE_URL` | Optional API base URL override |

## Data Storage

```
~/.hasna/connectors/connect-veo/
├── current_profile
└── profiles/
    └── default.json
```
