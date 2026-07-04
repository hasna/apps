# @hasna/connect-zoho-people

TypeScript connector for the [Zoho People](https://www.zoho.com/people/) HR API.

## Features

- Employees: list, get, lookup by email, add, update
- Leave: apply, balance, list, approve, cancel
- Attendance: reports, check-in/out, bulk punch, shifts, on-duty
- Timesheets: list, add, jobs, clients
- Organization: departments, designations, locations, forms, announcements

## Setup

```bash
bun install
cp .env.example .env
# Set ZOHOPEOPLE_TOKEN and optional ZOHOPEOPLE_DATA_CENTER
```

## Usage

```bash
# CLI
bun run dev employee list
bun run dev leave balance <userId>
bun run dev org details

# Library
import { ZohoPeople } from '@hasna/connect-zoho-people';

const zp = ZohoPeople.fromEnv();
const employees = await zp.listEmployees();
```

## Environment

| Variable | Description |
|----------|-------------|
| `ZOHOPEOPLE_TOKEN` | OAuth access token (`Zoho-oauthtoken`) |
| `ZOHOPEOPLE_DATA_CENTER` | Data center: `com`, `eu`, `in`, `com.au`, `jp`, `ca`, `sa` |
| `ZOHOPEOPLE_BASE_URL` | Optional base URL override |

## Development

```bash
bun run typecheck
bun test src/api/client.test.ts
bun run build
```

## License

Apache-2.0
