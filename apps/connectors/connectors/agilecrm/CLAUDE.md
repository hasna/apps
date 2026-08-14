# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-agilecrm is a TypeScript connector for the Agile CRM API. It provides access to contacts, companies, deals, tasks, and notes with HTTP Basic Auth authentication.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
```

## API Reference

- **Base URL**: `https://{domain}.agilecrm.com/dev/api`
- **Auth**: HTTP Basic Auth (email:apiKey)
- **Rate Limits**: Free 100/day, Starter 1K/day, Regular 5K/day, Enterprise 20K/day
- **Request Format**: JSON with `Accept: application/json` header
- **Pagination**: Cursor-based with `page_size` and `cursor` params

## API Modules

| Module | Endpoints |
|--------|-----------|
| `contacts` | list, get, getByEmail, getByPhone, create, update, delete, addTags, removeTags, updateLeadScore, updateStarValue, search, listCompanies |
| `deals` | list, get, create, update, delete, getByContact, getByMilestone, getMyDeals |
| `tasks` | list, get, create, update, delete, getPending, getByContact |
| `notes` | getByContact, create, deleteFromContact, getByDeal, createForDeal |

## CLI Commands

| Command | Description |
|---------|-------------|
| `profile list\|use\|create\|delete\|show` | Manage profiles |
| `config set-key\|set-email\|set-domain\|show\|clear` | Manage configuration |
| `contact list\|get\|search-email\|search\|delete\|companies` | Manage contacts |
| `deal list\|get\|create\|delete\|by-contact\|my-deals` | Manage deals |
| `task list\|get\|create\|delete\|pending` | Manage tasks |
| `note by-contact\|by-deal\|create` | Manage notes |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AGILECRM_API_KEY` | Agile CRM REST API key (overrides profile) |
| `AGILECRM_EMAIL` | Account email for Basic Auth |
| `AGILECRM_DOMAIN` | Agile CRM subdomain |

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Type annotations required everywhere
