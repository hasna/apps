# @hasna/connect-zoho-creator

Zoho Creator API v2.1 connector for low-code business apps, forms, reports, records, custom actions, and Deluge functions.

## Authentication

OAuth bearer token via `Zoho-oauthtoken` header. Obtain an access token from the [Zoho API Console](https://api-console.zoho.com/).

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZOHOCREATOR_ACCESS_TOKEN` | OAuth access token |
| `ZOHOCREATOR_DATA_CENTER` | Data center: `com`, `eu`, `in`, `com.au`, `jp`, `ca`, `sa` (default: `com`) |
| `ZOHOCREATOR_ENVIRONMENT` | `production` or `stage` (default: `production`) |

## CLI

```bash
bun run dev applications list
bun run dev reports records <owner> <app> <report> --criteria 'Status == "Open"'
bun run dev records add <owner> <app> <form> --data '{"Name":"Ada"}'
bun run dev functions invoke <owner> <app> <function> --payload '{"key":"value"}'
```

## Library

```typescript
import { ZohoCreator } from '@hasna/connect-zoho-creator';

const zc = ZohoCreator.fromEnv();
const apps = await zc.listApplications();
const records = await zc.getReportRecords('owner', 'MyApp', 'All_Records');
```

## API Coverage

24 operations: applications, forms, reports, records (CRUD + bulk by criteria), custom actions, Deluge functions, pages, fields, sections, users, file fields, and linked records.
