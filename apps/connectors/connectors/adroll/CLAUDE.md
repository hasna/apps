# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-adroll is a TypeScript connector for the AdRoll / NextRoll advertising platform API. It provides management of organizations, advertisables, campaigns, ad groups, ads, and audience segments through a clean CLI and programmatic interface.

## API Reference

- **Base URL**: `https://services.adroll.com`
- **API Path**: `/api/v1/`
- **Auth**: `Authorization: Token <personal_access_token>`
- **Rate Limit**: 100 requests/service/day
- **Pagination**: offset/limit query parameters
- **API Docs**: https://developers.nextroll.com/docs/

## API Modules

| Module | Description | Key Methods |
|--------|-------------|-------------|
| Organizations | Organization management | list, get |
| Advertisables | Advertisable accounts | list, get, create, edit |
| Campaigns | Campaign management | list, get, create, edit |
| Adgroups | Ad group management | list, get, create, edit |
| Ads | Ad management | list, get, create, edit |
| Segments | Audience segments | list, get |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ADROLL_API_KEY` | Personal Access Token (required) |
| `ADROLL_TOKEN` | Alias for ADROLL_API_KEY |

## Key Patterns

- Token authentication: `Authorization: Token <token>`
- Resource hierarchy: Organization → Advertisables → Campaigns → Adgroups → Ads
- All resources identified by EID (Entity ID)
- API uses GET for reads, POST for creates/edits
- Pagination via offset/limit query params

## CLI Commands

```bash
connect-adroll org list
connect-adroll org get <eid>
connect-adroll advertisable list <orgEid> [-l limit] [-o offset]
connect-adroll advertisable get <eid>
connect-adroll advertisable create <orgEid> -n <name> [-u url]
connect-adroll campaign list <advertisableEid> [-l limit] [-o offset]
connect-adroll campaign get <eid>
connect-adroll campaign create <advertisableEid> -n <name> [-b budget]
connect-adroll campaign edit <eid> [-n name] [-b budget] [-s status]
connect-adroll adgroup list <campaignEid> [-l limit] [-o offset]
connect-adroll adgroup get <eid>
connect-adroll adgroup create -n <name> -c <campaignEid>
connect-adroll ad list <advertisableEid> [-l limit] [-o offset]
connect-adroll ad get <eid>
connect-adroll ad create <advertisableEid> -n <name> -t <type>
connect-adroll segment list <advertisableEid> [-l limit] [-o offset]
connect-adroll segment get <eid>
connect-adroll profile list|use|create|delete|show
connect-adroll config set-key|show|clear
```

## Build & Run

```bash
bun install
bun run dev              # Run CLI in development
bun run build            # Build for distribution
bun run typecheck        # Type check
```
