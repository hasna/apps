# CLAUDE.md

This file provides guidance to Claude Code when working with the ZeroTier connector.

## Project Overview

`@hasna/connect-zerotier` is a TypeScript connector for the [ZeroTier Central REST API](https://docs.zerotier.com/api/central/legacy/). It manages SDN virtual networks, members, organizations, invites, SSO config, and audit logs via API key authentication.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
```

## Authentication

**API key** (not Bearer). Generate a key at [my.zerotier.com](https://my.zerotier.com) → Account → API Access.

The HTTP client sends `Authorization: token <apiKey>`.

Configure via:
- Environment variable: `ZEROTIER_API_KEY`
- Profile: `connect-zerotier config set-key <key>`
- CLI flag: `--api-key <key>`

## API Base URL

Default: `https://api.zerotier.com` (override with `ZEROTIER_BASE_URL`).

All endpoints are under `/api/v1/*`.

## CLI Commands

```bash
connect-zerotier status
connect-zerotier account

connect-zerotier org list
connect-zerotier org user list <orgId>
connect-zerotier org user add <orgId> <email> --role ROLE_ADMIN
connect-zerotier org invite list <orgId>
connect-zerotier org audit list <orgId> --limit 50

connect-zerotier network list
connect-zerotier network get <networkId>
connect-zerotier network create <name> --description "..."
connect-zerotier network delete <networkId>

connect-zerotier member list <networkId>
connect-zerotier member authorize <networkId> <nodeId>
connect-zerotier member deauthorize <networkId> <nodeId>
```

## Project Structure

```
src/
├── api/
│   ├── client.ts   # HTTP client (token auth)
│   └── index.ts    # ZeroTier API class
├── cli/index.ts    # Commander CLI
├── types/index.ts  # TypeScript interfaces
└── utils/          # config, output
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZEROTIER_API_KEY` | ZeroTier Central API key |
| `ZEROTIER_BASE_URL` | Optional API base URL override |

## Data Storage

Profiles: `~/.hasna/connectors/connect-zerotier/profiles/`
