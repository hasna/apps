# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-together-api-platform is a TypeScript connector for the Together Api Platform REST API. It provides items, events, search, and raw API access through a CLI and programmatic interface.

## API Reference

- **Base URL**: `https://api.togetherapiplatform.com/v1`
- **Auth**: Bearer token (`Authorization: Bearer <api_key>`)
- **API Docs**: https://www.ycombinator.com/companies/together-api-platform

## API Modules

| Module | Description | Key Methods |
|--------|-------------|-------------|
| Items | Item CRUD | listItems, createItem, getItem |
| Events | Event listing | listEvents |
| Search | Search API | search |
| Raw | Arbitrary endpoint access | rawRequest |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TOGETHER_API_PLATFORM_API_KEY` | API key (required) |
| `TOGETHER_API_PLATFORM_BASE_URL` | Override base URL (optional) |

## CLI Commands

```bash
connect-together-api-platform items list [--query <query>]
connect-together-api-platform items create [-d <json>] [--query <query>]
connect-together-api-platform items get <itemId>
connect-together-api-platform events list [--query <query>]
connect-together-api-platform search [-d <json>] [--query <query>]
connect-together-api-platform raw <path> [-m <method>] [-d <json>] [-q <query>]
connect-together-api-platform profile list|use|create|delete|show
connect-together-api-platform config set-key|set-base-url|show|clear
```

## Build & Run

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test src/api/client.test.ts
```
