# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-actionnetwork is a TypeScript connector for the Action Network API v2. Action Network is a progressive organizing platform for petitions, events, fundraising, advocacy campaigns, email messaging, and people management. It follows the OSDI (Open Supporter Data Interface) specification.

## API Details

- **Base URL**: `https://actionnetwork.org/api/v2`
- **Auth**: Custom header `OSDI-API-Token: <api_key>`
- **Format**: HAL+JSON (OSDI spec v1.1.1)
- **Rate Limits**: 4 requests/second, messages limited to 1 POST/30 seconds

## Build & Run Commands

```bash
bun install
bun run dev                    # Run CLI in development
bun run build                  # Build for distribution
bun run typecheck              # Type check

# Example commands
bun run dev people list
bun run dev petitions list --filter "modified_date gt '2024-01-01'"
bun run dev events create --title "Town Hall" --start-date "2024-06-01T18:00:00Z"
bun run dev tags create --name "Volunteer"
bun run dev fundraising donations <pageId>
```

## API Modules

| Module | Resource | Endpoints |
|--------|----------|-----------|
| `people` | People/Activists | list, get, signup, update |
| `petitions` | Petitions | list, get, create, update, listSignatures, createSignature |
| `events` | Events | list, get, create, update, listAttendances, createAttendance |
| `forms` | Forms | list, get, create, update, listSubmissions, createSubmission |
| `fundraising` | Fundraising Pages | list, get, create, update, listDonations, createDonation |
| `tags` | Tags | list, get, create, listTaggings, createTagging, deleteTagging |
| `messages` | Email Messages | list, get, create, update |
| `advocacy` | Advocacy Campaigns | list, get, create, update, listOutreaches |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ACTION_NETWORK_API_KEY` | OSDI API token (overrides profile) |
| `ACTION_NETWORK_TOKEN` | Token alias for API key |
| `ACTION_NETWORK_API_SECRET` | API secret (optional) |

## Key Patterns

### HAL+JSON Response Format

All list endpoints return HAL collections:
```json
{
  "_links": { "self": { "href": "..." }, "next": { "href": "..." } },
  "_embedded": { "osdi:people": [...] },
  "total_pages": 5,
  "per_page": 25,
  "page": 1,
  "total_records": 120
}
```

### OData Filtering

List endpoints support OData `$filter` for date-based queries:
```
filter=modified_date gt '2024-01-01'
filter=created_date lt '2024-06-01'
```

### Person Signup (Upsert)

POST to `/people` acts as upsert - creates new or updates existing based on email match.

## CLI Commands

| Command | Description |
|---------|-------------|
| `people list/get/signup/update` | Manage activists |
| `petitions list/get/create/update/signatures/sign` | Petition campaigns |
| `events list/get/create/update/attendances/attend` | Event management |
| `forms list/get/create/update/submissions/submit` | Form management |
| `fundraising list/get/create/update/donations/donate` | Fundraising |
| `tags list/get/create/taggings/tag-person/untag` | Tag management |
| `messages list/get/create/update` | Email messaging |
| `advocacy list/get/create/update/outreaches` | Advocacy campaigns |
| `profile list/use/create/delete/show` | Profile management |
| `config set-key/show/clear` | Configuration |
