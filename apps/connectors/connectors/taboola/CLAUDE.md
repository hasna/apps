# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-taboola is a TypeScript connector for the Taboola Backstage API, the native-advertising
platform. It provides management of accounts, campaigns, campaign items (creatives), reports, and
first-party audiences through a clean CLI and programmatic interface.

## API Reference

- **Base URL**: `https://backstage.taboola.com/backstage`
- **API Path**: `/api/1.0/`
- **Token endpoint**: `POST /oauth/token` (OAuth2 client_credentials)
- **Auth**: `Authorization: Bearer <access_token>`
- **Token lifetime**: ~12 hours (client caches and refreshes automatically)
- **API Docs**: https://developers.taboola.com/backstage-api/reference

## API Modules

| Module | Description | Key Methods |
|--------|-------------|-------------|
| Account | Account configuration | listAllowed, getCurrent |
| Campaigns | Campaign management | list, get, create, update, remove |
| CampaignItems | Creatives per campaign | list, get, create, update, remove |
| Reports | Performance reporting | campaignSummary, topCampaignContent |
| Audiences | First-party audiences | createFirstParty, getCampaignTargeting, updateCampaignTargeting |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TABOOLA_CLIENT_ID` | OAuth2 client id (required for client_credentials) |
| `TABOOLA_CLIENT_SECRET` | OAuth2 client secret (required for client_credentials) |
| `TABOOLA_ACCOUNT_ID` | Default account/network id to operate on |
| `TABOOLA_ACCESS_TOKEN` | Optional pre-issued Bearer token (alternative to credentials) |
| `TABOOLA_BASE_URL` | Optional base URL override |

## Key Patterns

- OAuth2 client_credentials: the client fetches and caches a Bearer token, refreshing before expiry.
- Bearer authentication: `Authorization: Bearer <token>`.
- Resource hierarchy: Account → Campaigns → Items.
- Taboola uses POST for both create and update on campaigns and items.
- List responses are wrapped under `results` with optional `metadata`.
- Reports are dimension-based and require `start_date`/`end_date` (YYYY-MM-DD).

## CLI Commands

```bash
connect-taboola account list
connect-taboola account current
connect-taboola campaign list
connect-taboola campaign get <campaignId>
connect-taboola campaign create -n <name> -b <brandingText> -c <cpc> -s <spendingLimit>
connect-taboola campaign update <campaignId> [--pause|--activate] [-c cpc]
connect-taboola item list <campaignId>
connect-taboola item get <campaignId> <itemId>
connect-taboola item create <campaignId> -u <url> [-t title]
connect-taboola item update <campaignId> <itemId> [--pause|--activate]
connect-taboola report campaign-summary <dimension> --start-date <d> --end-date <d>
connect-taboola report top-content <dimension> --start-date <d> --end-date <d>
connect-taboola audience create -n <name> [--ttl hours]
connect-taboola audience targeting <campaignId>
connect-taboola profile list|use|create|delete|show
connect-taboola config set-credentials <clientId> <clientSecret>
connect-taboola config set-account <accountId>
connect-taboola config show|clear
```

Global options: `-a/--account <accountId>`, `-f/--format <json|table|pretty>`, `-p/--profile <name>`, `-v/--verbose`.

## Build & Run

```bash
bun install
bun run dev              # Run CLI in development
bun run build            # Build for distribution
bun run typecheck        # Type check
bun test                 # Run tests
```
