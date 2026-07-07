# CLAUDE.md

TikTok Events API 2.0 connector — server-side conversion events via `POST /event/track/`.

## API

- **Base URL**: `https://business-api.tiktok.com/open_api/v1.3`
- **Auth**: `Access-Token` header
- **Track endpoint**: `POST /event/track/`
- **Docs**: https://business-api.tiktok.com/portal/docs

## Distinction from connect-tiktok

`connect-tiktok` is the Marketing API (campaigns, ads, legacy `/pixel/track/`). This package is Events API 2.0 only.

## Commands

Event tracking: `track-event`, `track-web-event`, `track-lead`, `track-purchase`, etc.

Admin: `list-pixels`, `create-pixel`, `list-offline-event-sets`, `list-crm-event-sets`, `raw-request`.

Most commands accept `--data '{"..."}'` JSON payloads matching the library method options.

## Build

```bash
bun install && bun run typecheck && bun run build && bun test
```
