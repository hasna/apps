# AGENTS.md

Guidance for AI agents working with the WaboxApp connector.

## Overview

`@hasna/connect-waboxapp` wraps the WaboxApp REST API for WhatsApp chat, image, link, media sending, and account status checks.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

API token + sender uid (query/body param, not Bearer). Configure via CLI or `WABOXAPP_TOKEN` / `WABOXAPP_UID`.

## Structure

```
src/
├── api/       # client, messages, status
├── cli/       # Commander CLI
├── types/
└── utils/     # config, output
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WABOXAPP_TOKEN` | API token |
| `WABOXAPP_UID` | Sender WhatsApp number (international format) |
| `WABOXAPP_BASE_URL` | Optional API base URL override |
