# Zoho Projects Connector

TypeScript connector for the [Zoho Projects REST API](https://www.zoho.com/projects/help/rest-api/zoho-projects-rest-api.html).

## Authentication

Zoho Projects uses OAuth 2.0. Generate an access token from the [Zoho API Console](https://api-console.zoho.com/) with Projects scopes.

## Data Centers

Set `ZOHOPROJECTS_DATA_CENTER` to match your Zoho account region:

| Value | API base |
|-------|----------|
| `com` (default) | `https://projectsapi.zoho.com` |
| `eu` | `https://projectsapi.zoho.eu` |
| `in` | `https://projectsapi.zoho.in` |
| `com.au` | `https://projectsapi.zoho.com.au` |
| `jp` | `https://projectsapi.zoho.jp` |
| `ca` | `https://projectsapi.zoho.ca` |
| `sa` | `https://projectsapi.zoho.sa` |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZOHOPROJECTS_TOKEN` | OAuth access token |
| `ZOHOPROJECTS_PORTAL_ID` | Default portal ID for portal-scoped calls |
| `ZOHOPROJECTS_DATA_CENTER` | Data center region (default: `com`) |
| `ZOHOPROJECTS_BASE_URL` | Optional API base URL override |

## Quick Start

```bash
bun install
cp .env.example .env
# Edit .env with your credentials

bun run dev portals list
bun run dev projects list --portal-id <portal-id>
bun run dev tasks list <project-id>
```

## Library Usage

```typescript
import { ZohoProjects } from '@hasna/connect-zohoprojects';

const zp = ZohoProjects.fromEnv();
const portals = await zp.listPortals();
const projects = await zp.listProjects('your-portal-id');
```

## Commands

- `portals list` — List accessible portals
- `projects list|get|create|delete` — Project CRUD
- `tasks list|get|create|delete` — Task CRUD
- `profile` / `config` — Multi-profile credential management

## Development

```bash
bun run typecheck
bun test
bun run build
```
