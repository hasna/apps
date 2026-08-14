# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-webengage is a TypeScript connector for the WebEngage marketing automation REST API. It supports user tracking, event tracking, bulk operations, and transactional campaign delivery.

## API Reference

- **Base URLs** (data center dependent):
  - Global: `https://api.webengage.com`
  - India: `https://api.in.webengage.com`
  - Saudi Arabia: `https://api.ksa.webengage.com`
  - Europe: `https://api.eug.webengage.com`
- **Auth**: `Authorization: Bearer <API_KEY>`
- **Account scoping**: All endpoints use `/v1/accounts/{licenseCode}/...` or `/v2/accounts/{licenseCode}/...`
- **API Docs**: https://docs.webengage.com/docs/rest-api-getting-started

## API Modules

| Module | Description | Key Methods |
|--------|-------------|-------------|
| Users | Create/update user profiles | track |
| Events | Track custom events | track |
| Bulk | Batch user/event updates | trackUsers, trackEvents |
| Transactional | Trigger campaigns | send, sendMulti |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WEBENGAGE_API_KEY` | REST API key (required) |
| `WEBENGAGE_LICENSE_CODE` | Account license code (required) |
| `WEBENGAGE_DC` | Data center: `global`, `in`, `sa`, `eug` |
| `WEBENGAGE_BASE_URL` | Optional host override |

## CLI Commands

```bash
connect-webengage users track --user-id <id> [--email <email>] [--file <json>]
connect-webengage events track --user-id <id> --name <eventName> [--file <json>]
connect-webengage bulk users --file <json>
connect-webengage bulk events --file <json>
connect-webengage transaction send <experimentId> --user-id <id> --file <json>
connect-webengage transaction multi --file <json>
connect-webengage profile list|use|create|delete|show
connect-webengage config set-key|set-license|set-dc|show|clear
```

## Build & Run

```bash
bun install
bun run dev              # Run CLI in development
bun run build            # Build for distribution
bun run typecheck        # Type check
bun test                 # Run tests
```
