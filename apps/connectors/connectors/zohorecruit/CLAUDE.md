# CLAUDE.md

Zoho Recruit ATS connector for `@hasna/connect-zohorecruit`.

## Overview

OAuth REST client for Zoho Recruit API v2. Base URL pattern: `https://recruit.zoho.{dc}/recruit/v2`.

## Auth

- Header: `Authorization: Zoho-oauthtoken {access_token}`
- OAuth via Zoho accounts (`accounts.zoho.com` or regional equivalents)
- Env: `ZOHORECRUIT_TOKEN`, `ZOHORECRUIT_DATA_CENTER`, optional `ZOHORECRUIT_BASE_URL`

## Data Centers

| DC | Base host |
|----|-----------|
| com | recruit.zoho.com |
| eu | recruit.zoho.eu |
| in | recruit.zoho.in |
| com.au | recruit.zoho.com.au |
| jp | recruit.zoho.jp |
| ca | recruit.zoho.ca |
| sa | recruit.zoho.sa |

## Commands

```bash
bun install
bun run dev records list Candidates
bun run typecheck
bun test
bun run build
```

## API Modules

- Records: CRUD, search, upsert (`Candidates`, `JobOpenings`, etc.)
- Jobs: associate candidates, change status, status history
- Notes & attachments on records
- Settings: modules, fields, layouts, custom views, tags
- Users, webhooks, organization

## Docs

https://www.zoho.com/recruit/developer-guide/apiv2/
