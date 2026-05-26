# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

`connect-activetrail` is a TypeScript connector for the ActiveTrail email marketing and automation API. It provides programmatic access to contacts, groups, campaigns, reports, automations, templates, and webhooks.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
```

## API Reference

- **Base URL**: `https://webapi.mymarketing.co.il/api`
- **Auth**: Raw token in `Authorization` header (no Bearer prefix)
- **Pagination**: `Page` and `Limit` query params (max 100 per page)
- **PUT/DELETE**: Return headers only (no response body)
- **Field naming**: PascalCase (e.g., `FirstName`, `Email`, `CreatedDate`)

## API Modules

| Module | Class | Endpoints |
|--------|-------|-----------|
| Contacts | `ContactsApi` | list, get, create, update, delete, import, getGroups, getActivity, getUnsubscribers, getSubscribers |
| Groups | `GroupsApi` | list, get, create, update, delete, getMembers, addMember, removeMember |
| Campaigns | `CampaignsApi` | list, get, create, update, delete, getTemplate, updateTemplate, getSchedule, updateSchedule, getSentCampaigns |
| Reports | `ReportsApi` | list, get, getOpens, getClicks, getBounces, getUnsubscribed, getComplaints |
| Automations | `AutomationsApi` | list, get, delete, getDetails, updateDetails, activate |
| Templates | `TemplatesApi` | list, get, create, update, delete, createCampaignFromTemplate |
| Webhooks | `WebhooksApi` | list, create, update, delete, test |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ACTIVETRAIL_API_KEY` | API token (required) |

## CLI Commands

```bash
connect-activetrail contacts list|get|create|update|delete|unsubscribers
connect-activetrail groups list|get|create|update|delete|members|add-member|remove-member
connect-activetrail campaigns list|get|create|update|delete|sent
connect-activetrail reports list|get|opens|clicks|bounces|unsubscribed
connect-activetrail automations list|get|delete|details|activate|deactivate
connect-activetrail templates list|get|create|update|delete
connect-activetrail webhooks list|create|update|delete|test
connect-activetrail profile list|use|create|delete|show
connect-activetrail config set-key|show|clear
```

## Key Patterns

- ActiveTrail uses raw token auth (not Bearer token)
- PUT and DELETE endpoints return no response body
- All API types use PascalCase field names
- Contacts are identified by email address (not numeric ID)
- Groups use numeric IDs
- Pagination is 1-based with `Page` and `Limit` parameters
