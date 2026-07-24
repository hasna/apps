# CLAUDE.md

This file provides guidance to Claude Code when working with the Stagehand connector.

## Project Overview

`connect-stagehand` is a TypeScript connector for the official Stagehand v3 session API at `https://api.stagehand.browserbase.com`. It provides REST-only CLI and programmatic access to Browserbase-hosted Stagehand sessions.

## Authentication

The connector must use official Stagehand v3 headers:

- `x-bb-api-key` from `BROWSERBASE_API_KEY`
- `x-model-api-key` from `MODEL_API_KEY`
- optional `x-bb-project-id` from `BROWSERBASE_PROJECT_ID`

Do not reintroduce bearer-token auth or the legacy Stagehand-specific API key variable name.

## Build & Run

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## CLI Commands

```bash
connect-stagehand config set-browserbase-key <key>
connect-stagehand config set-model-key <key>
connect-stagehand config set-project-id <projectId>
connect-stagehand sessions start --model openai/gpt-5.4-mini
connect-stagehand sessions navigate <sessionId> https://example.com
connect-stagehand sessions act <sessionId> "Click the login button"
connect-stagehand sessions observe <sessionId> "Find navigation links"
connect-stagehand sessions extract <sessionId> "Extract product names" --schema '{"type":"object"}'
connect-stagehand sessions agent <sessionId> "Complete the workflow" --model openai/gpt-5.4-mini
connect-stagehand sessions replay <sessionId>
connect-stagehand sessions end <sessionId>
connect-stagehand raw request -p /v1/sessions/start -m POST -b '{"modelName":"openai/gpt-5.4-mini"}'
```

## API Surface

- `startSession` - POST `/v1/sessions/start`
- `navigate` - POST `/v1/sessions/{id}/navigate`
- `act` - POST `/v1/sessions/{id}/act`
- `observe` - POST `/v1/sessions/{id}/observe`
- `extract` - POST `/v1/sessions/{id}/extract`
- `agentExecute` - POST `/v1/sessions/{id}/agentExecute`
- `replay` - GET `/v1/sessions/{id}/replay`
- `endSession` - POST `/v1/sessions/{id}/end`
- `rawRequest` - arbitrary path/method

## Environment Variables

| Variable | Description |
|----------|-------------|
| `BROWSERBASE_API_KEY` | Browserbase API key for `x-bb-api-key` |
| `MODEL_API_KEY` | Model provider API key for `x-model-api-key` |
| `BROWSERBASE_PROJECT_ID` | Optional project ID for `x-bb-project-id` |
| `STAGEHAND_BASE_URL` | Optional API base URL; default is `https://api.stagehand.browserbase.com` |

## Notes

Keep this connector REST-only. Do not add `@browserbasehq/stagehand`, Playwright, Puppeteer, Selenium, browser-use, or browser automation runtime dependencies.
