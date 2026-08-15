# CLAUDE.md

Zoho Projects connector for the open-connectors monorepo.

## Overview

`@hasna/connect-zohoprojects` wraps the Zoho Projects REST API (`/restapi` paths) with OAuth token auth and multi-profile CLI configuration.

## Authentication

- **Type:** OAuth 2.0 (`Zoho-oauthtoken` header)
- **Token:** Set via `ZOHOPROJECTS_TOKEN` env var or `connect-zohoprojects config set-token`
- **Scopes:** Zoho Projects API scopes from Zoho API Console

## Data Centers

Portal-scoped routes require `portalId`. Set default via `ZOHOPROJECTS_PORTAL_ID` or `--portal-id`.

Supported `ZOHOPROJECTS_DATA_CENTER` values: `com`, `eu`, `in`, `com.au`, `jp`, `ca`, `sa`.

## Commands

```bash
bun run dev portals list
bun run dev projects list --portal-id <id>
bun run dev tasks list <projectId>
bun run typecheck
bun test src/api/client.test.ts
```

## API Surface

The `ZohoProjects` class exposes portals, projects, tasks, tasklists, milestones, bugs, forums, events, time logs, users, clients, project groups, documents, and tags — matching the public Zoho Projects REST API.

## Config Storage

`~/.hasna/connectors/connect-zohoprojects/profiles/`
