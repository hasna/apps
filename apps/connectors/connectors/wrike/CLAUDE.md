# CLAUDE.md

This file provides guidance to Claude Code when working with the Wrike connector.

## Project Overview

`@hasna/connect-wrike` is a TypeScript connector for the [Wrike REST API v4](https://developers.wrike.com/). It provides a CLI and programmatic interface for tasks, folders, spaces, workflows, custom fields, comments, timelogs, contacts, groups, invitations, attachments, and version.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Wrike uses a permanent API access token with **lowercase** `bearer` in the Authorization header:

```typescript
Authorization: `bearer ${apiToken}`
```

Configure via CLI or environment:

```bash
connect-wrike config set-token <api-token>
connect-wrike config set-host www.wrike.com
```

| Variable | Description |
|----------|-------------|
| `WRIKE_API_TOKEN` | API access token (overrides profile) |
| `WRIKE_HOST` | Account host (default `www.wrike.com`; EU tenants may use `app-eu.wrike.com`) |

Dashboard auth detection: document `config set-token` and `config set-host` in CLAUDE.md (apikey/bearer, no OAuth).

## Data Storage

```
~/.hasna/connectors/connect-wrike/
├── current_profile
└── profiles/
    └── default.json
```

Profile JSON:

```json
{
  "apiToken": "your-token",
  "host": "www.wrike.com"
}
```

## API Notes

- Base URL: `https://{host}/api/v4`
- `fields` query parameters must be JSON-stringified arrays
- Host is per-tenant; never hardcode beyond the default

## Project Structure

```
src/
├── api/
│   ├── client.ts
│   ├── client.test.ts
│   └── index.ts
├── cli/
│   └── index.ts
├── types/
│   └── index.ts
├── utils/
│   ├── config.ts
│   └── output.ts
└── index.ts
```
