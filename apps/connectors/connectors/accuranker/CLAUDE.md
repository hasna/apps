# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

AccuRanker connector - a TypeScript CLI and library for interacting with the AccuRanker SEO rank tracking API. Provides keyword rank tracking, domain management, and SERP monitoring.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
```

## API Details

- **Base URL**: `https://app.accuranker.com/api/v4/`
- **Auth**: Token-based (`Authorization: Token <api-token>`)
- **Rate Limits**: 100 requests/minute (read), 500 burst (write)

### Read API (GET endpoints - trailing slashes)

- `GET /accounts/` - List accounts
- `GET /accounts/{id}/` - Get account
- `GET /domains/` - List domains
- `GET /domains/{id}/` - Get domain
- `GET /domains/{id}/keywords/` - List keywords
- `GET /domains/{id}/keywords/{kid}/` - Get keyword
- `GET /domains/{id}/landing_pages/` - List landing pages
- `GET /domains/{id}/landing_pages/{pid}/` - Get landing page
- `GET /domains/{id}/tags/` - List tags

### Write API (POST/PUT/DELETE - no trailing slashes)

- `POST /domain/` - Create domain
- `PUT /domain/{id}` - Update domain
- `DELETE /domain/{id}` - Delete domain
- `POST /keyword/` - Create keywords (async, returns 202)
- `PUT /keyword/` - Update keywords
- `DELETE /keyword/` - Delete keywords (body: keyword_ids)
- `POST /group/` - Create group
- `PUT /group/{id}` - Update group
- `DELETE /group/{id}` - Delete group
- `GET /overview/group_domains` - List groups with domains

### Async Operations

Keyword creation returns HTTP 202 with a `Location` header pointing to a job status endpoint:
- `GET /status/keyword_job/{id}` - Check job status

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ACCURANKER_API_KEY` | API token (overrides profile config) |
| `ACCURANKER_TOKEN` | Alias for API token |

## CLI Commands

```bash
connect-accuranker accounts list
connect-accuranker accounts get <id>
connect-accuranker domains list [--fields <fields>]
connect-accuranker domains get <id> [--fields <fields>]
connect-accuranker domains create --domain <domain> --group-id <id>
connect-accuranker domains delete <id>
connect-accuranker keywords list --domain-id <id> [--fields] [--limit] [--offset]
connect-accuranker keywords get <kid> --domain-id <id>
connect-accuranker keywords create --domain-id <id> --keywords <k1,k2>
connect-accuranker keywords delete --keyword-ids <id1,id2>
connect-accuranker keywords job-status <jobId>
connect-accuranker landing-pages list --domain-id <id>
connect-accuranker landing-pages get <pageId> --domain-id <id>
connect-accuranker tags list --domain-id <id>
connect-accuranker groups list [--include-subaccounts]
connect-accuranker groups create --account-id <id> --name <name>
connect-accuranker groups update <id> --name <name>
connect-accuranker groups delete <id>
connect-accuranker config set-key <token>
connect-accuranker config show
connect-accuranker profile list|use|create|delete|show
```
