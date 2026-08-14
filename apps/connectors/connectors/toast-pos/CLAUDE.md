# CLAUDE.md

This file provides guidance to Claude Code when working with the Toast POS connector.

## Project Overview

connect-toast-pos is a TypeScript CLI and library for the Toast Tab restaurant platform APIs. It uses OAuth2 client-credentials (machine client) authentication and requires a restaurant external ID header on location-scoped requests.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

OAuth2 client-credentials with Toast machine client access:

- Obtain `clientId` and `clientSecret` from the Toast integrations team
- Login endpoint: `POST /authentication/v1/authentication/login`
- Request body includes `userAccessType: "TOAST_MACHINE_CLIENT"`
- Present `Authorization: Bearer <accessToken>` on API requests
- Include `Toast-Restaurant-External-ID: <restaurant-guid>` on restaurant-scoped endpoints

Configure via CLI (`config set-credentials`, `config set-restaurant`) or environment variables.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TOAST_CLIENT_ID` | Toast API client ID |
| `TOAST_CLIENT_SECRET` | Toast API client secret |
| `TOAST_RESTAURANT_EXTERNAL_ID` | Restaurant location GUID |
| `TOAST_BASE_URL` | Optional API hostname override |

## Data Storage

```
~/.hasna/connectors/connect-toast-pos/
├── current_profile
└── profiles/
    └── default.json
```

## API Modules

- `restaurants` — `/restaurants/v1/...`
- `menus` — `/menus/v3/menus`
- `orders` — `/orders/v2/orders`, `/orders/v2/ordersBulk`
- `raw request` — authenticated escape hatch

## Dependencies

- commander
- chalk
