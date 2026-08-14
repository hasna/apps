# CLAUDE.md

This file provides guidance to Claude Code when working with the Wayco connector.

## Project Overview

`@hasna/connect-wayco` is a TypeScript connector for the [Wayco](https://wayco.ai/) med-legal AI API. It provides Bearer token authentication, multi-profile CLI configuration, and typed client methods for cases, leads, medical records, provider matching, and voice calls.

## Authentication

**Bearer Token**

Set `WAYCO_API_KEY` or save a key with `connect-wayco config set-key <key>`.

Optional `WAYCO_BASE_URL` overrides the default `https://api.wayco.ai/v1`.

## Build & Run

```bash
bun install
bun run dev list-cases --status intake
bun run typecheck
bun test
bun run build
```

## API Methods

| CLI command | API |
|-------------|-----|
| `list-cases` | `GET /cases` |
| `get-case <id>` | `GET /cases/{caseId}` |
| `create-lead --body '{...}'` | `POST /leads` |
| `qualify-lead <id> --body '{...}'` | `POST /leads/{leadId}/qualify` |
| `summarize-medical-records <id> --body '{...}'` | `POST /cases/{caseId}/medical-records/summary` |
| `match-providers <id> --body '{...}'` | `POST /cases/{caseId}/provider-matches` |
| `get-voice-call <id>` | `GET /voice-calls/{callId}` |
| `raw-request --path /custom --method POST --body '{...}'` | arbitrary path |

Path segments are URL-encoded. POST bodies are JSON.

## Configuration

Profiles live in `~/.hasna/connectors/connect-wayco/profiles/`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WAYCO_API_KEY` | Bearer API key |
| `WAYCO_BASE_URL` | Optional API base URL |
