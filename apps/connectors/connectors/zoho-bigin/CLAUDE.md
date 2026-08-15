# CLAUDE.md

Zoho Bigin connector for the open-connectors monorepo.

## Overview

`@hasna/connect-zoho-bigin` wraps the Zoho Bigin v2 REST API (`https://www.zohoapis.com/bigin/v2`) with OAuth token auth and a Commander CLI.

## Commands

```bash
bun install
bun run dev contacts list
bun run typecheck
bun test src/api/client.test.ts
bun run build
```

## Structure

```
src/
├── api/
│   ├── client.ts      # HTTP client (Zoho-oauthtoken, retry on 429/5xx)
│   ├── client.test.ts
│   └── index.ts       # ZohoBigin class
├── cli/index.ts       # contacts|companies|pipelines|tasks|raw
├── types/index.ts
└── utils/
    ├── config.ts      # CONNECTOR_NAME=connect-zoho-bigin, ZOHOBGIN_TOKEN
    └── output.ts
```

## Auth

Uses `Authorization: Zoho-oauthtoken <token>`. Token from `ZOHOBGIN_TOKEN` env var or profile `~/.hasna/connectors/connect-zoho-bigin/profiles/`.

## API Endpoints

| Method | Path |
|--------|------|
| listContacts | GET /Contacts |
| getContact | GET /Contacts/:id |
| addContacts | POST /Contacts |
| listCompanies | GET /Accounts |
| listPipelines | GET /Pipelines |
| listTasks | GET /Tasks |
| rawRequest | arbitrary path |

## Registry

Registered in `src/lib/connectors/business-tools.ts` as `zoho-bigin`.
