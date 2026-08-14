# CLAUDE.md

This file provides guidance to Claude Code when working with the connect-activecampaign connector.

## Overview

ActiveCampaign API connector for CRM, marketing automation, email campaigns, contacts, deals, tags, lists, automations, webhooks, and notes.

## API Details

- **Base URL**: `https://<accountname>.api-us1.com/api/3` (account-specific)
- **Auth**: Custom header `Api-Token: <api_key>` (NOT Bearer token)
- **Rate Limit**: 5 requests/second
- **Format**: JSON REST
- **Docs**: https://developers.activecampaign.com/reference

## API Modules

| Module | File | Resources |
|--------|------|-----------|
| Contacts | `src/api/contacts.ts` | CRUD, sync/upsert, tags, lists, automations, deals |
| Deals | `src/api/deals.ts` | CRUD, notes, stages, pipelines |
| Accounts | `src/api/accounts.ts` | CRUD, contact associations |
| Campaigns | `src/api/campaigns.ts` | List, get, links, messages (read-only) |
| Tags | `src/api/tags.ts` | CRUD |
| Lists | `src/api/lists.ts` | CRUD (mailing lists) |
| Automations | `src/api/automations.ts` | List, get, add/remove contacts |
| Webhooks | `src/api/webhooks.ts` | CRUD |
| Notes | `src/api/notes.ts` | CRUD |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ACTIVECAMPAIGN_API_KEY` | API key (required) |
| `ACTIVECAMPAIGN_BASE_URL` | Account URL (required, e.g. `https://myaccount.api-us1.com`) |
| `ACTIVECAMPAIGN_API_SECRET` | API secret (optional) |
| `ACTIVECAMPAIGN_TOKEN` | Token alias for API key |

## CLI Commands

```bash
connect-activecampaign contacts list|get|create|update|delete|sync|tags|add-tag|remove-tag
connect-activecampaign deals list|get|create|update|delete|stages|pipelines
connect-activecampaign accounts list|get|create|update|delete
connect-activecampaign campaigns list|get
connect-activecampaign tags list|get|create|update|delete
connect-activecampaign lists list|get|create|delete
connect-activecampaign automations list|get|add-contact|remove-contact
connect-activecampaign webhooks list|get|create|delete
connect-activecampaign notes get|create|update|delete
```

## Key Patterns

- Request bodies wrap data in singular resource key: `{ "contact": { ... } }`
- Base URL auto-appends `/api/3` if not present
- Pagination via `limit` and `offset` query params
- Filters passed as query params: `filters[email]=test@example.com`

## Build & Run

```bash
bun install
bun run dev -- --help
bun run build
bun run typecheck
```
