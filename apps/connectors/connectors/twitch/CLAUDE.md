# CLAUDE.md

## Project Overview

connect-twitch is a TypeScript connector for the Twitch Helix API with OAuth2 authentication and multi-profile configuration.

## Build & Run

```bash
bun install
bun run dev
bun run build
bun run typecheck
```

## Authentication

OAuth authentication. Credentials via environment variables or profile config:

- `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`
- `TWITCH_ACCESS_TOKEN`, `TWITCH_REFRESH_TOKEN`
- OAuth flow: `connect-twitch auth login`

## API Modules

- **UsersApi**: Get user by login or authenticated user
- **ChannelsApi**: Channel metadata
- **StreamsApi**: Live streams
- **SearchApi**: Channel search
- **ChatApi**: List chatters, send chat messages
- **FollowersApi**: List channel followers

## Helix Base URL

`https://api.twitch.tv/helix` with `Authorization: Bearer` + `Client-Id` headers.

Token refresh: `https://id.twitch.tv/oauth2/token`
