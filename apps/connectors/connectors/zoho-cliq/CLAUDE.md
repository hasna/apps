# CLAUDE.md

Zoho Cliq connector — team chat and messaging via Zoho Cliq REST API v2.

## Commands

```bash
bun install
bun run dev
bun run typecheck
bun test src/api/client.test.ts
```

## Auth

OAuth access token with `Authorization: Zoho-oauthtoken <token>` header.

Data centers: `com`, `eu`, `in`, `com.au`, `jp`, `ca`, `sa` — base URL `https://cliq.zoho.{dc}/api/v2`.

## Structure

```
src/api/client.ts    # HTTP client + DC resolver
src/api/users.ts     # Users API
src/api/channels.ts  # Channels API
src/api/messages.ts  # Messages API
src/api/chats.ts     # Chats API
src/cli/index.ts     # CLI commands
```

## Environment

| Variable | Description |
|----------|-------------|
| `ZOHO_CLIQ_TOKEN` | OAuth access token |
| `ZOHO_CLIQ_DATA_CENTER` | Data center (default: com) |

Config stored in `~/.hasna/connectors/connect-zoho-cliq/`.
