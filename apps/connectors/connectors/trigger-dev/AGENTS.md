# AGENTS.md

Guidance for AI agents working with the Trigger.dev connector.

## Overview

`@hasna/connect-trigger-dev` is a thin REST client for Trigger.dev's v1 API (`https://api.trigger.dev/v1`).

## Auth

- Type: Bearer API key
- Env: `TRIGGER_DEV_API_KEY`
- Profiles: `~/.hasna/connectors/connect-trigger-dev/`

## Commands

| Operation | HTTP | Path |
|-----------|------|------|
| listRuns | GET | /runs |
| createRun | POST | /runs |
| getRun | GET | /runs/{runId} |
| listEvents | GET | /events |
| search | POST | /search |
| rawRequest | * | custom |

## Security

- No hardcoded secrets
- `.env.example` uses placeholders only
- No browser-use dependency

## Distinction

This is **trigger-dev** (real Trigger.dev API at `/v1`). Do not confuse with sibling slug **trigger-dev-api-platform**.
