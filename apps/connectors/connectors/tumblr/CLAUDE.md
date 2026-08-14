# CLAUDE.md

## Project Overview

connect-tumblr is a TypeScript connector for the Tumblr API v2 with OAuth2 authentication and multi-profile configuration support.

API docs: https://github.com/tumblr/docs/blob/master/api.md

## Build & Run

```bash
bun install
bun run dev
bun run build
bun run typecheck
```

## Authentication

OAuth2 via Tumblr:
- Authorize: `https://www.tumblr.com/oauth2/authorize`
- Token: `https://api.tumblr.com/v2/oauth2/token`

Environment variables:
- `TUMBLR_CLIENT_ID`
- `TUMBLR_CLIENT_SECRET`
- `TUMBLR_ACCESS_TOKEN`
- `TUMBLR_REFRESH_TOKEN`

Profiles stored in `~/.hasna/connectors/connect-tumblr/profiles/`.

## API Modules

- **UsersApi**: info, dashboard, likes, following, follow/unfollow, like/unlike
- **BlogsApi**: info, avatar, likes, followers, following
- **PostsApi**: list, drafts, queue, submissions, create, update, delete, reblog, notes, get-by-ids
- **TagsApi**: searchByTag

## Dependencies

commander, chalk
