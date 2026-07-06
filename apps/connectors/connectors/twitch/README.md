# connect-twitch

TypeScript connector for the [Twitch Helix API](https://dev.twitch.tv/docs/api/) with OAuth2 authentication and multi-profile configuration.

## Features

- Users, channel info, live streams, channel search
- Chatters list and send chat message (Helix Chat API)
- Channel followers
- OAuth2 login with token refresh
- CLI and programmatic API

## Quick Start

```bash
bun install
bun run dev auth login
bun run dev user
bun run dev streams --limit 5
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TWITCH_CLIENT_ID` | Twitch application Client ID |
| `TWITCH_CLIENT_SECRET` | Twitch application Client Secret |
| `TWITCH_ACCESS_TOKEN` | OAuth access token |
| `TWITCH_REFRESH_TOKEN` | OAuth refresh token |

## License

Apache-2.0
