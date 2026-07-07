# connect-teamwork

Teamwork.com connector - projects, tasks, milestones, time tracking, and people.

## API Details

- **Base URL**: `https://{installation}.teamwork.com`
- **API version**: v3, under the `/projects/api/v3` path prefix
- **Auth**: HTTP Basic auth — API token as the username, any string as the password
  (`Authorization: Basic base64("<token>:x")`)
- **Response format**: `{ "<resource>": ... , "included": {...}, "meta": { "page": {...} } }`
- **Pagination**: `page` (1-indexed) and `pageSize` query params; `meta.page.hasMore` signals more results
- **Rate limits**: `429` responses are retried with backoff honoring `Retry-After`

## Environment Variables

| Variable                | Description                                        |
| ----------------------- | ------------------------------------------------- |
| `TEAMWORK_API_KEY`      | Teamwork API token (Basic auth username)          |
| `TEAMWORK_INSTALLATION` | Site name (subdomain of `{installation}.teamwork.com`) |
| `TEAMWORK_BASE_URL`     | Optional full base URL override                   |

`TEAMWORK_API_TOKEN` is accepted as an alias for `TEAMWORK_API_KEY`.

## CLI Commands

```bash
connect-teamwork projects list|get|create|delete
connect-teamwork tasks list|get|create|complete|delete
connect-teamwork tasklists list|get|create
connect-teamwork milestones list|get
connect-teamwork people list|get|me
connect-teamwork companies list|get
connect-teamwork time list
connect-teamwork comments list
connect-teamwork profile list|use|create|delete|show
connect-teamwork config set-key|set-installation|set-base-url|show|clear
```

## Structure

- `src/api/client.ts` — Basic-auth HTTP client with retries and base-URL building
- `src/api/params.ts` — `V3` path prefix and `ListParams` → query mapping
- `src/api/*.ts` — one module per resource; `index.ts` exposes the `Connector` facade
- `src/types/index.ts` — config, resource, and error types
- `src/utils/` — config/profiles, output, settings, storage, bulk helpers
- `src/cli/index.ts` — Commander CLI
- `src/api/client.test.ts` — transport/auth/path unit tests (`bun test`)

## Build & Run

```bash
bun install
bun run dev
bun run typecheck
bun run build
bun test
```
