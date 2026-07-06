# CLAUDE.md

Guidance for working on `@hasna/connect-timelinesai`.

## Overview

TimelinesAI Public REST API connector with Bearer token auth. Base URL: `https://app.timelines.ai/integrations/api`.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test src/api/client.test.ts
```

## Structure

```
src/
├── api/
│   ├── client.ts           # Bearer HTTP client
│   ├── chats.ts            # List/get/update chats
│   ├── messages.ts         # Send and list messages
│   ├── whatsapp-accounts.ts
│   └── index.ts            # TimelinesAI class
├── cli/index.ts
├── types/index.ts
└── utils/config.ts         # ~/.hasna/connectors/connect-timelinesai
```

## Authentication

Bearer token from TimelinesAI dashboard Public API page. Env: `TIMELINESAI_API_KEY`. Optional `TIMELINESAI_BASE_URL`.

## API Coverage (in scope)

- `GET/PATCH /chats`, `GET /chats/{id}`
- `POST /messages`, `POST/GET /chats/{id}/messages`
- `GET /whatsapp_accounts`
- `rawRequest` for advanced paths

Out of scope unless needed: files, labels, webhooks, workspace/teammates endpoints.

## Dependencies

commander, chalk only.
