# CLAUDE.md

Solcast API connector — solar PV power forecasts, live estimated actuals, and historic data.

## Build & Run

```bash
bun install
bun run dev
bun run build
bun run typecheck
```

## Authentication

API Key authentication. Credentials via:
- `SOLCAST_API_KEY` environment variable
- `connect-solcast config set-key <key>`

Optional `SOLCAST_BASE_URL` overrides the default `https://api.solcast.com.au`.

## API Notes

- Auth: `api_key` query parameter + `format=json`
- Rooftop PV endpoints: `/data/forecast|live|historic/rooftop_pv_power`
- Site endpoints: `/rooftop_sites/{id}/forecasts`, `/rooftop_sites/{id}/estimated_actuals`
- Docs: https://docs.solcast.com.au

## Data Storage

```
~/.hasna/connectors/connect-solcast/
└── config.json
```
