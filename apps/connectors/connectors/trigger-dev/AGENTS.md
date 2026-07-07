# AGENTS.md

Guidance for AI agents working with the Trigger.dev connector.

## Overview

`@hasna/connect-trigger-dev` is a thin REST client for Trigger.dev's management API (`https://api.trigger.dev/api/v1`).

## Auth

- Type: Bearer secret key
- Env: `TRIGGER_SECRET_KEY` preferred, `TRIGGER_DEV_API_KEY` supported for compatibility
- Profiles: `~/.hasna/connectors/connect-trigger-dev/`

## Commands

| Operation | HTTP | Path |
|-----------|------|------|
| listRuns | GET | /runs |
| triggerTask/createRun | POST | /tasks/{taskIdentifier}/trigger |
| getRun | GET | /runs/{runId} |
| listEvents | GET | /runs/{runId}/events |
| search | POST | /query |
| rawRequest | * | custom |

## Security

- No hardcoded secrets
- `.env.example` uses placeholders only
- No browser-use dependency

## Distinction

This is **trigger-dev** (real Trigger.dev management API at `/api/v1`). Do not confuse with sibling slug **trigger-dev-api-platform**.
