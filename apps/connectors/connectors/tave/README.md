# @hasna/connect-tave

Tave connector - a studio-management CRM for photographers and creative studios. Access contacts, jobs (shoots), leads, and orders through a typed API client and a CLI.

## Install

```bash
bun install
```

## Authentication

Tave uses a Bearer API key. Create an API key in your Tave account settings, then either:

- Set the `TAVE_API_KEY` environment variable, or
- Save it to a profile: `connect-tave config set-key <key>`

The default base URL is `https://tave.io/v2`. Override it with `TAVE_BASE_URL` or `--base-url` if needed.

Copy `.env.example` to `.env` and fill in your key:

```bash
cp .env.example .env
```

## CLI usage

```bash
# Contacts
connect-tave contacts list --limit 25
connect-tave contacts get <id>

# Jobs (shoots/projects)
connect-tave jobs list --status active
connect-tave jobs get <id>

# Leads
connect-tave leads list
connect-tave leads get <id>
connect-tave leads create --first-name Ada --email ada@example.com --event-type wedding

# Orders / invoices
connect-tave orders list
connect-tave orders get <id>

# Raw escape hatch for any endpoint
connect-tave raw request /contacts
connect-tave raw request /leads -X POST -d '{"email":"a@b.com"}'
```

Global options: `-k, --api-key`, `-f, --format <json|table|pretty>`, `-p, --profile`, `-v, --verbose`, `--base-url`.

## Programmatic usage

```ts
import { Connector } from '@hasna/connect-tave';

const tave = new Connector({ apiKey: process.env.TAVE_API_KEY! });

const contacts = await tave.contacts.list({ perPage: 50 });
const lead = await tave.leads.create({ email: 'ada@example.com', event_type: 'wedding' });

// Escape hatch for endpoints without a dedicated wrapper
const anything = await tave.raw.get('/orders', { page: 1 });
```

## Scripts

- `bun run typecheck` — type-check with `tsc`
- `bun run build` — bundle the library and CLI
- `bun test` — run the focused client tests

## License

Apache-2.0
