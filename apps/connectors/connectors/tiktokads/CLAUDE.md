# CLAUDE.md

## Project Overview

connect-tiktokads is a TypeScript connector for the TikTok Marketing API (Advertising category). It provides CLI and library access for advertisers, campaigns, ad groups, ads, integrated reporting, pixels, and creative file uploads.

Distinct from `connect-tiktok` (Social Media slug) — same upstream API base URL but separate package, config namespace (`TIKTOK_ADS_*`), and Alumia registry slug `tiktokads`.

## Build & Run

```bash
bun install
bun run dev
bun run build
bun run typecheck
```

## API

- Base URL: `https://business-api.tiktok.com/open_api/v1.3`
- Auth header: `Access-Token: <token>`
- Errors: HTTP 200 with `code !== 0` in JSON body

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TIKTOK_ADS_CLIENT_ID` | OAuth app ID |
| `TIKTOK_ADS_CLIENT_SECRET` | OAuth app secret |
| `TIKTOK_ADS_ACCESS_TOKEN` | Access token |
| `TIKTOK_ADS_ADVERTISER_ID` | Default advertiser ID |

## Project Structure

```
src/
├── api/          # Client + resource modules
├── cli/          # Commander CLI
├── types/        # Type definitions
├── utils/        # config, auth, output
└── index.ts
```

## Dependencies

commander, chalk, open (OAuth browser launch)
