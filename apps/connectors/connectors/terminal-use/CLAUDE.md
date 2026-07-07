# CLAUDE.md

Guidance for working with the Terminal Use connector.

## Overview

`connect-terminal-use` is a TypeScript connector for the [Terminal Use](https://docs.terminaluse.com) API — agent deployment runtime with tasks, messages, and persistent filesystems.

## Commands

```bash
bun install
bun run dev
bun run typecheck
bun test
```

## API

- **Base URL**: `https://api.terminaluse.com`
- **Auth**: Bearer token (`Authorization: Bearer <token>`)
- **Optional**: `x-agent-api-key` header for agent-scoped operations

## CLI

| Area | Commands |
|------|----------|
| Profile | `profile list\|use\|create\|delete\|show` |
| Config | `config set-key\|set-agent-key\|show\|clear` |
| Projects | `projects list\|create` |
| Agents | `agents list\|get\|get-by-name\|deploy` |
| Tasks | `tasks list\|create\|get\|cancel\|send-text-event\|send-data-event\|stream` |
| Messages | `messages list\|get` |
| Filesystems | `filesystems create\|list\|get\|list-files\|get-file\|upload-url\|download-url\|sync-complete` |
| Raw | `raw-request` |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TERMINAL_USE_TOKEN` | API bearer token |
| `TERMINALUSE_API_KEY` | Alias for bearer token |
| `TERMINAL_USE_AGENT_API_KEY` | Optional agent API key |
| `TERMINAL_USE_BASE_URL` | Override API base URL |
