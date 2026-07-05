# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-twocaptcha is a TypeScript connector for the [2Captcha API](https://2captcha.com/2captcha-api). It provides captcha task creation, result polling, balance checks, and solution reporting.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Type annotations required everywhere

## Architecture

### Authentication

2Captcha uses `clientKey` in the JSON request body (API key from the dashboard).

### Base URL

```
https://api.2captcha.com
```

All endpoints use POST with `Content-Type: application/json`.

### Response Format

Responses include `errorId` (0 = success). Non-zero `errorId` values indicate API errors even when HTTP status is 200.

## Project Structure

```
src/
├── api/
│   ├── client.ts     # POST-only HTTP client with clientKey injection
│   ├── tasks.ts      # createTask, getTaskResult, getBalance, report*
│   └── index.ts      # Main Connector class
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # Type definitions
├── utils/
│   ├── config.ts     # Multi-profile config (~/.hasna/connectors/connect-twocaptcha/)
│   └── output.ts     # CLI output formatting
└── index.ts          # Library exports
```

## API Endpoints

- `POST /createTask` — Submit a captcha solving task
- `POST /getTaskResult` — Poll task result by taskId
- `POST /getBalance` — Get account balance
- `POST /reportCorrect` — Report a correct solution
- `POST /reportIncorrect` — Report an incorrect solution

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TWOCAPTCHA_API_KEY` | 2Captcha API key (overrides profile) |

## CLI Commands

```bash
connect-twocaptcha task create --task '{"type":"RecaptchaV2TaskProxyless","websiteURL":"...","websiteKey":"..."}'
connect-twocaptcha task create --type ImageToTextTask
connect-twocaptcha task result <taskId>
connect-twocaptcha balance get
connect-twocaptcha report correct <taskId>
connect-twocaptcha report incorrect <taskId> [--reason <code>]
connect-twocaptcha config set-key <key>
connect-twocaptcha config show
connect-twocaptcha profile list|use|create|delete|show
```
