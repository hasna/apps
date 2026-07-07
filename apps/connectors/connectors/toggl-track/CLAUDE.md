# CLAUDE.md

Toggl Track API connector (`@hasna/connect-toggl-track`).

## Authentication

API token auth via HTTP Basic: `Authorization: Basic base64(<api_token>:api_token)`.

- Base URL: `https://api.track.toggl.com/api/v9`
- Docs: https://engineering.toggl.com/docs/
- Env var: `TOGGL_TRACK_API_TOKEN`

## Commands

```bash
bun install
bun run dev me
bun run typecheck
bun test
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TOGGL_TRACK_API_TOKEN` | API token from Toggl Track profile |
| `TOGGL_TRACK_BASE_URL` | Optional API base URL override |

## Profile Storage

`~/.hasna/connectors/connect-toggl-track/profiles/`
