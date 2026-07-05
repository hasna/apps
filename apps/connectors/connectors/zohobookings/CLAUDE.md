# CLAUDE.md

Zoho Bookings connector for appointment scheduling via the public Zoho Bookings REST API.

## Commands

```bash
bun install
bun run dev          # CLI
bun run build
bun run typecheck
```

## Auth

- **Type**: OAuth access token (`Zoho-oauthtoken` header)
- **Scope**: `zohobookings.data.CREATE`
- **Env**: `ZOHOBOOKINGS_TOKEN`, optional `ZOHOBOOKINGS_BASE_URL` for multi-DC (e.g. `https://www.zohoapis.eu`)

## Structure

```
src/
├── api/client.ts   # HTTP transport, form encoding, envelope parsing
├── api/index.ts    # ZohoBookings facade
├── cli/index.ts    # Commander CLI
├── types/index.ts
└── utils/config.ts # Profiles at ~/.hasna/connectors/zohobookings/
```

## API patterns

- GET: query parameters on `/bookings/v1/json/{endpoint}`
- POST: `application/x-www-form-urlencoded`; JSON-stringify nested objects
- Response envelope: `response.returnvalue` on success; `response.errormessage` on failure
