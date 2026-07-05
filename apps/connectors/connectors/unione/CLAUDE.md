# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

UniOne transactional email API connector — send emails, manage templates, validate addresses, subscribe contacts, and list webhooks/projects.

API reference: https://docs.unione.io/en/web-api-ref

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test src/api/unione.test.ts
```

## Authentication

API Key via `X-API-KEY` header. Set via:
- Environment variable `UNIONE_API_KEY`
- Profile: `connect-unione config set-key <key>`

## API Endpoints

| CLI command | API path |
|-------------|----------|
| send-email | /email/send.json |
| subscribe-email | /email/subscribe.json |
| validate-email | /email-validation/single.json |
| set-template | /template/set.json |
| get-template | /template/get.json |
| list-templates | /template/list.json |
| list-webhooks | /webhook/list.json |
| list-projects | /project/list.json |

All endpoints use `POST` with `application/json`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `UNIONE_API_KEY` | API key from UniOne dashboard |

## Data Storage

```
~/.hasna/connectors/unione/
├── current_profile
└── profiles/
    └── default.json
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
