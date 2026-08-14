# @hasna/connect-takecareos

TakeCareOS connector for the [open-connectors](https://github.com/hasna/open-connectors) registry.

TakeCareOS is a home-care agency operating system. This connector wraps its public
REST API to manage clients (care recipients), caregivers, shifts, incident reports,
invoices and compliance reporting.

## Install

```bash
bun install
```

## Authentication

The connector authenticates with a Bearer API key. Provide it via environment
variable, a CLI flag, or a stored profile:

```bash
export TAKECAREOS_API_KEY=your-api-key
# optional, for a dedicated/regional host
export TAKECAREOS_BASE_URL=https://api.takecareos.com/v1
```

## Library usage

```ts
import { TakeCareOS } from "@hasna/connect-takecareos";

const tc = TakeCareOS.fromEnv(); // reads TAKECAREOS_API_KEY / TAKECAREOS_BASE_URL
// or: new TakeCareOS({ apiKey: "...", baseUrl: "..." })

const clients = await tc.listClients({ status: "active", perPage: 50 });
const client = await tc.getClient("client_123");

const shift = await tc.createShift({
  client_id: "client_123",
  caregiver_id: "cg_9",
  start_time: "2026-07-06T09:00:00Z",
  end_time: "2026-07-06T12:00:00Z",
  service_type: "personal_care",
});

await tc.createIncident({
  client_id: "client_123",
  type: "fall",
  severity: "high",
  description: "Client slipped in the bathroom; no injury.",
});

const report = await tc.getComplianceReport({ from: "2026-06-01", to: "2026-06-30" });

// Escape hatch for endpoints not modelled here:
const raw = await tc.rawRequest("/custom/endpoint", { params: { q: "x" } });
```

## API surface

| Method | Endpoint | Description |
| --- | --- | --- |
| `listClients(opts)` | `GET /clients` | List care recipients |
| `getClient(id)` | `GET /clients/:id` | Fetch a single client |
| `listCaregivers(opts)` | `GET /caregivers` | List caregivers |
| `listShifts(opts)` | `GET /shifts` | List scheduled shifts |
| `createShift(input)` | `POST /shifts` | Schedule a shift |
| `listIncidents(opts)` | `GET /incidents` | List incident reports |
| `createIncident(input)` | `POST /incidents` | File an incident report |
| `listInvoices(opts)` | `GET /invoices` | List client invoices |
| `getComplianceReport(opts)` | `GET /compliance/report` | Agency compliance snapshot |
| `rawRequest(path, opts)` | any | Passthrough for unmodelled endpoints |

## CLI

```bash
# configure a profile
takecareos config set-key <api-key>
takecareos config set-base-url https://api.takecareos.com/v1

# operations
takecareos clients list --status active --per-page 50
takecareos clients get client_123
takecareos caregivers list
takecareos shifts list --client-id client_123 --from 2026-07-01 --to 2026-07-31
takecareos shifts create --client-id client_123 --start 2026-07-06T09:00:00Z --end 2026-07-06T12:00:00Z
takecareos incidents list --severity high
takecareos incidents create --type fall --description "Client slipped" --client-id client_123
takecareos invoices list --status unpaid
takecareos compliance report --from 2026-06-01 --to 2026-06-30

# JSON output
takecareos --format json clients list
```

## Development

```bash
bun run typecheck
bun run build
bun test
```

## License

Apache-2.0
