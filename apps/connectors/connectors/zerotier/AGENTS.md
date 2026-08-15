# AGENTS.md

`@hasna/connect-zerotier` — ZeroTier Central REST API connector.

- **Auth**: API key via `Authorization: token <key>` (not Bearer)
- **Env**: `ZEROTIER_API_KEY`, optional `ZEROTIER_BASE_URL`
- **Base URL**: `https://api.zerotier.com/api/v1`
- **Commands**: `bun install`, `bun run dev`, `bun run typecheck`, `bun run build`

Key API surface: status, networks, members, organizations, users, invites, SSO, audit logs.
