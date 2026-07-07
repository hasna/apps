# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-streak is a TypeScript connector for the Streak CRM API. Streak is a CRM built into Gmail with pipelines, boxes, stages, custom fields, tasks, comments, email threads, reminders, and files.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
```

## API Reference

- **Default Base URL**: `https://api.streak.com/api/v1`
- **Auth**: HTTP Basic (`Authorization: Basic base64(apiKey:)`)
- **API versions**: Most endpoints use `/api/v1`; tasks and comments use `/api/v2`; box create uses `/api/v2`, while box read/update/delete use `/api/v1`.
- **Body format**: Legacy `/api/v1` pipeline/stage/field create endpoints use URL-encoded form bodies; `/api/v2` create/update endpoints use JSON.
- **Docs**: https://streak.readme.io/

## API Modules

| Module | Resource | Endpoints |
|--------|----------|-----------|
| `pipelines` | Pipelines | list, get, create (v1 PUT form), update (v1 POST JSON), delete |
| `boxes` | Boxes | list/get/delete (v1), create (v2 POST JSON), update (v1 POST JSON) |
| `stages` | Stages | list, create per pipeline (v1 PUT form) |
| `fields` | Custom fields | list, create per pipeline (v1 PUT form) |
| `tasks` | Tasks | list/create/update/delete (v2) |
| `comments` | Comments | list/create/delete (v2) |
| `threads` | Email threads | list per box |
| `reminders` | Reminders | list, create per box |
| `files` | Files | list per box |
| `teams` | Teams | list, get users |
| `users` | Users | me, get |
| `search` | Search | free-text query |

## CLI Commands

| Command | Description |
|---------|-------------|
| `profile list\|use\|create\|delete\|show` | Manage profiles |
| `config set-key\|show\|clear` | Manage configuration |
| `get-current-user` | Get authenticated user |
| `list-pipelines` / `get-pipeline` / `create-pipeline` / `update-pipeline` / `delete-pipeline` | Pipeline CRUD |
| `list-boxes` / `get-box` / `create-box` / `update-box` / `delete-box` | Box CRUD |
| `list-stages` / `create-stage` | Stage management |
| `list-fields` / `create-field` | Custom fields |
| `list-tasks` / `create-task` / `update-task` / `delete-task` | Tasks |
| `list-comments` / `create-comment` / `delete-comment` | Comments |
| `list-threads` | Email threads |
| `list-reminders` / `create-reminder` | Reminders |
| `list-files` | Files |
| `list-teams` / `list-users-on-team` | Teams |
| `get-user` | User lookup |
| `search` | Free-text search |

## Authentication

Streak uses API key authentication via HTTP Basic auth. The API key is sent as the username with an empty password (`apiKey:` base64-encoded).

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STREAK_API_KEY` | Streak API key (overrides profile) |

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Type annotations required everywhere
