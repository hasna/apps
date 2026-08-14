# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-voltair is a TypeScript connector for the Voltair AI project run API. It provides both a CLI tool and a TypeScript library for listing projects, creating runs, and querying run status.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
```

## Authentication

Bearer token authentication. Credentials can be set via:
- Environment variable: `VOLTAIR_API_KEY`
- Profile configuration: `connect-voltair config set-key <key>`

Optional `VOLTAIR_BASE_URL` overrides the default `https://api.voltair.ai/v1`.

## API Surface

- `GET /projects` — list projects
- `GET /projects/{projectId}` — get project
- `POST /projects/{projectId}/runs` — create run
- `GET /projects/{projectId}/runs/{runId}` — get run
- `raw-request` — arbitrary path/method/query/body

Docs: https://google.github.io/VoltAir/doc/API-Ref/html/index.html

## CLI Commands

```bash
connect-voltair projects list
connect-voltair projects list -q '{"limit":5}'
connect-voltair projects get "proj 1"
connect-voltair runs create "proj 1" -b '{"prompt":"optimize this route"}'
connect-voltair runs get "proj 1" "run 1"
connect-voltair raw-request --path /custom/endpoint -m POST -b '{"enabled":true}'
connect-voltair config set-key <key>
connect-voltair profile list
```

## Data Storage

Profiles stored in `~/.hasna/connectors/connect-voltair/profiles/`.
