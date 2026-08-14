# CLAUDE.md

This file provides guidance to Claude Code when working with the connect-supportbee connector.

## Overview

SupportBee API connector for the shared-inbox helpdesk: tickets, replies (customer-facing),
comments (internal notes), labels, agents/users, and canned-reply snippets.

## API Details

- **Base URL**: `https://<company>.supportbee.com` (company-specific)
- **Auth**: `Authorization: Bearer <token>` header
- **Format**: JSON REST
- **Docs**: https://supportbee.com/api

## API Modules

| Module | File | Resources |
|--------|------|-----------|
| Tickets | `src/api/tickets.ts` | list, get, create, delete (trash) |
| Replies | `src/api/replies.ts` | list, create (customer-facing) |
| Comments | `src/api/comments.ts` | list, create (internal notes) |
| Labels | `src/api/labels.ts` | list, add to ticket, remove from ticket |
| Users | `src/api/users.ts` | list, get (agents) |
| Snippets | `src/api/snippets.ts` | list, get, create, update, delete |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SUPPORTBEE_API_KEY` | Auth token (required) |
| `SUPPORTBEE_BASE_URL` | Company URL (required, e.g. `https://your-company.supportbee.com`) |
| `SUPPORTBEE_SUBDOMAIN` | Company subdomain slug (alternative to `SUPPORTBEE_BASE_URL`) |
| `SUPPORTBEE_TOKEN` | Token alias for the auth token |

## CLI Commands

```bash
connect-supportbee ticket list|get|create|delete
connect-supportbee reply list|create
connect-supportbee comment list|create
connect-supportbee label list|add|remove
connect-supportbee user list|get
connect-supportbee snippet list|get|create|update|delete
```

## Key Patterns

- Request bodies wrap data in the singular resource key: `{ "ticket": { ... } }`, `{ "reply": { ... } }`.
- Ticket/reply/comment bodies use a `content` object: `{ "text": "...", "html": "..." }`.
- Labels are applied/removed by name via `/tickets/{id}/labels/{name}`.
- Pagination via `page` and `per_page` query params.

## Build & Run

```bash
bun install
bun run dev -- --help
bun run build
bun run typecheck
```
