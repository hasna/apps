# Zoho Bookings Connector

TypeScript connector for the [Zoho Bookings API](https://www.zoho.com/bookings/help/api/v1/oauthauthentication.html) — workspaces, services, staff, availability, appointments, and customers.

## Authentication

OAuth 2.0 access token with scope `zohobookings.data.CREATE`. Pass via environment variable or CLI profile:

```bash
export ZOHOBOOKINGS_TOKEN="your-oauth-access-token"
# Optional multi-DC override (default: https://www.zohoapis.com)
export ZOHOBOOKINGS_BASE_URL="https://www.zohoapis.eu"
```

## CLI

```bash
bun install
bun run dev workspaces list
bun run dev services list --workspace-id <id>
bun run dev appointments list --from "01-Jul-2026 00:00:00" --to "31-Jul-2026 23:59:59"
bun run dev appointments book --service-id <id> --staff-id <id> --from-time "04-Jul-2026 10:00:00" --name "Jane Doe" --email jane@example.com
```

## Library

```typescript
import { ZohoBookings } from '@hasna/connect-zohobookings';

const bookings = ZohoBookings.fromEnv();
const workspaces = await bookings.listWorkspaces();
```

## API notes

- Base path: `{origin}/bookings/v1/json/{endpoint}`
- POST bodies use `application/x-www-form-urlencoded`; nested objects (e.g. `customer_details`) are JSON-encoded strings
- `fetchappointment` expects filters wrapped in a `data` field
- Date format: `dd-MMM-yyyy HH:mm:ss`
