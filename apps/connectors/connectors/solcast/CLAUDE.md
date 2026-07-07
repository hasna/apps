# CLAUDE.md

Solcast API connector — solar PV power forecasts, live estimated actuals, and historic data.

## Project Overview

Solcast API connector CLI and library for rooftop PV power forecasts, live estimated actuals, historic data, and registered site endpoints against the public Solcast REST API.

## Build & Run

```bash
bun install
bun run dev
bun run build
bun run typecheck
```

## Authentication

API Key authentication. Credentials can be set via:
- Environment variable `SOLCAST_API_KEY`
- Profile configuration: `connect-solcast config set-key <key>`

Auth is sent as the `api_key` query parameter with `format=json`.

## CLI Commands

```bash
# Configuration
connect-solcast config set-key <key>
connect-solcast config set-base-url <url>
connect-solcast config show
connect-solcast config clear

# Rooftop PV by location
connect-solcast forecast rooftop-pv-power --lat <lat> --lon <lon> --capacity <kw>
connect-solcast live rooftop-pv-power --lat <lat> --lon <lon> --capacity <kw>
connect-solcast historic rooftop-pv-power --lat <lat> --lon <lon> --capacity <kw> --start <iso> --end <iso>

# Registered rooftop sites
connect-solcast site forecasts <site-id>
connect-solcast site actuals <site-id>

# Raw API access
connect-solcast raw --path /data/forecast/rooftop_pv_power --lat <lat> --lon <lon> --capacity <kw>
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SOLCAST_API_KEY` | Solcast API key |
| `SOLCAST_BASE_URL` | Optional API base URL override (default `https://api.solcast.com.au`) |

## Data Storage

```
~/.hasna/connectors/connect-solcast/
└── config.json
```

## API Notes

- Base URL: `https://api.solcast.com.au`
- Rooftop PV: `/data/forecast|live|historic/rooftop_pv_power`
- Sites: `/rooftop_sites/{id}/forecasts`, `/rooftop_sites/{id}/estimated_actuals`
- Docs: https://docs.solcast.com.au
