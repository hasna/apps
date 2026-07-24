# CLAUDE.md

This file provides guidance to Claude Code when working with the v0 Platform API connector.

## Project Overview

`@hasna/connect-v0` is a TypeScript CLI and library for the [v0 Platform API](https://v0.app/docs/api/platform/overview).

- **Authentication**: Bearer token (`V0_API_KEY` or profile `apiKey`)
- **Base URL**: `https://api.v0.dev/v1` (override via `V0_BASE_URL` or profile `baseUrl`)

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## API Surface

| Resource | Endpoints |
|----------|-----------|
| User | `GET /user`, `GET /user/scopes` |
| Projects | `GET/POST /projects`, `GET/PUT/DELETE /projects/:id` |
| Chats | `GET/POST /chats`, `GET/DELETE /chats/:id` |
| Messages | `GET/POST /chats/:id/messages`, `GET /chats/:id/messages/:messageId` |
| Deployments | `GET/POST /deployments`, `GET /deployments/:id` |
| Completions | `POST /chat/completions` |

## CLI Examples

```bash
connect-v0 config set-key <api-key>
connect-v0 user get
connect-v0 projects list
connect-v0 chats create -m "Create a todo app"
connect-v0 chat-completions -m "Hello" --model v0-1.5-md
connect-v0 deployments create --chat-id <id> --version-id <id>
```

## Configuration

Profiles stored in `~/.hasna/connectors/connect-v0/profiles/`.

| Variable | Description |
|----------|-------------|
| `V0_API_KEY` | API key from v0.dev/chat/settings/keys |
| `V0_BASE_URL` | Optional API base URL override |

## Auth Type

Bearer token — detected by dashboard auth from this CLAUDE.md.
