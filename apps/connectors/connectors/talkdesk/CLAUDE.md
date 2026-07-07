# CLAUDE.md

Guidance for Claude Code when working in `@hasna/connect-talkdesk`.

## Overview

A CLI + library wrapper for the Talkdesk cloud contact center API, rebuilt from
the public docs at https://docs.talkdesk.com. No Talkdesk internal or
platform-specific code is used.

## Authentication

**OAuth 2.0 client credentials grant** (machine-to-machine). The client
(`src/api/client.ts`) POSTs `grant_type=client_credentials` to
`${baseUrl}/oauth/token` with HTTP Basic auth of `client_id:client_secret`,
then attaches the returned bearer token as `Authorization: Bearer <token>` on
every request. Tokens are cached and refreshed 30s before expiry. A
pre-obtained `accessToken` may be supplied to skip the exchange.

## Structure

```
src/
├── api/
│   ├── client.ts      # OAuth token exchange + HTTP client (retry/timeout)
│   ├── users.ts       # Users API
│   ├── contacts.ts    # Contacts API
│   ├── reports.ts     # Explore reporting API (async jobs)
│   └── index.ts       # Talkdesk facade (users/contacts/reports)
├── cli/index.ts       # Commander CLI (bin: connect-talkdesk)
├── types/index.ts     # TalkdeskConfig + resource types + TalkdeskApiError
├── utils/
│   ├── config.ts      # Multi-profile config (~/.hasna/connectors/connect-talkdesk)
│   ├── output.ts      # json/table/pretty formatting
│   └── logger.ts      # verbose debug logging
└── index.ts           # Library exports
```

## Base URL & endpoints (from public docs)

- Base URL: `https://api.talkdeskapp.com` (region-specific; override via `TALKDESK_BASE_URL`).
- Token: `POST /oauth/token`.
- Users: `GET /users`, `GET /users/{id}`, `GET /users/me`.
- Contacts: `GET /contacts`, `GET /contacts/{id}`, `POST /contacts`, `PUT /contacts/{id}`, `DELETE /contacts/{id}`.
- Explore calls report: `POST /data/reports/calls/jobs`, `GET /data/reports/calls/jobs/{id}`.

## Commands

```bash
bun install
bun run typecheck
bun test
bun run build
bun run dev users list   # run the CLI in dev
```

## Conventions

- TypeScript strict mode, ESM, async/await.
- Dependencies limited to `commander` and `chalk`.
- No secrets committed; `.env.example` holds placeholders only.
