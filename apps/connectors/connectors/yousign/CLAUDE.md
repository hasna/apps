# CLAUDE.md

Guidance for working with the Yousign connector (`@hasna/connect-yousign`).

## Project Overview

Yousign API v3 connector for electronic signatures. Bearer token authentication with production and sandbox environments.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test src/api/client.test.ts
```

## Authentication

API key authentication via Bearer token in `src/api/client.ts`:

```typescript
'Authorization': `Bearer ${this.apiKey}`,
```

Profiles support `apiKey` and `environment` (`production` | `sandbox`).

## Environment Variables

| Variable | Description |
|----------|-------------|
| `YOUSIGN_API_KEY` | API key (overrides profile) |
| `YOUSIGN_ENVIRONMENT` | `production` or `sandbox` (default: production) |

## Data Storage

```
~/.hasna/connectors/connect-yousign/
├── current_profile
└── profiles/
    └── default.json
```

Profile JSON structure:

```json
{
  "apiKey": "your-api-key",
  "environment": "production"
}
```

## API Base URLs

- Production: `https://api.yousign.app/v3`
- Sandbox: `https://api-sandbox.yousign.app/v3`

## CLI Global Flags

| Flag | Description |
|------|-------------|
| `-k, --api-key <key>` | Override API key |
| `-p, --profile <name>` | Use specific profile |
| `-e, --environment <env>` | production or sandbox |
| `-f, --format <format>` | json or pretty |

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
