# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-vwo is a TypeScript connector for the VWO (Visual Website Optimizer) REST API. It provides A/B testing, multivariate testing, feature flags, surveys, heatmaps, session recordings, and conversion optimization through a CLI and programmatic interface.

## API Reference

- **Base URL**: `https://app.vwo.com/api/v2`
- **Auth**: `token` header + `X-Account-ID` header (not Bearer)
- **API Docs**: https://developers.vwo.com/

## Authentication

API key authentication using API token and account ID. Credentials can be set via:
- Environment variables: `VWO_API_TOKEN`, `VWO_ACCOUNT_ID`
- Profile configuration: `connect-vwo config set --api-token <token> --account-id <id>`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VWO_API_TOKEN` | VWO API token (required) |
| `VWO_ACCOUNT_ID` | VWO account ID (required) |

## API Modules

| Module | Description | Key Methods |
|--------|-------------|-------------|
| Account | Account info | me |
| Campaigns | A/B and multivariate tests | list, get, create, update, delete, run, pause, report |
| Goals | Conversion goals | list, get, create, update, delete |
| Segments | Audience segments | list, get, create, update, delete |
| FeatureFlags | Feature flag management | list, get, create, update, delete, toggle |
| Environments | Feature flag environments | list, get, create, delete |
| Metrics | Custom metrics | list, create, delete |
| Surveys | On-site surveys | list, get, responses |
| Heatmaps | Click/scroll heatmaps | list, get |
| SessionRecordings | Session replay | list, get |
| Webhooks | Event webhooks | list, create, update, delete |
| AuditLog | Account audit trail | list |
| Users | Team users | list, invite, remove |

## CLI Commands

```bash
connect-vwo account
connect-vwo campaigns list [--status <s>] [--type <t>]
connect-vwo campaigns get <id>
connect-vwo campaigns run <id>
connect-vwo campaigns pause <id>
connect-vwo campaigns report <id> [--start-date <d>] [--end-date <d>]
connect-vwo goals list
connect-vwo segments list
connect-vwo feature-flags list
connect-vwo feature-flags toggle <id> --environment <key> --enabled true
connect-vwo surveys list
connect-vwo heatmaps list
connect-vwo session-recordings list
connect-vwo webhooks list
connect-vwo audit-log
connect-vwo users list
connect-vwo config set --api-token <token> --account-id <id>
connect-vwo profile list|use|create|delete|show
```

## Build & Run

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test src/api/client.test.ts
```

## Data Storage

```
~/.hasna/connectors/connect-vwo/
├── current_profile
└── profiles/
    └── default.json
```
