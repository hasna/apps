# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the
`@hasna/connect-smtp2go` connector.

## Project Overview

A TypeScript library and CLI wrapping the SMTP2GO v3 API
(https://developers.smtp2go.com/). It sends transactional email and manages
delivery statistics, suppressions, sender domains, single senders, and SMTP users.

## Build & Run Commands

```bash
bun install
bun run dev            # run the CLI
bun run dev email send --sender ... --to ... --subject ... --text ...
bun run typecheck
bun test
bun run build          # emits dist/ (library) and bin/ (CLI)
bun run release        # bump patch + publish
bun run release:dry
```

## API Shape

The SMTP2GO v3 API is unusual: **every endpoint is a POST** that takes a JSON
body and returns a `{ request_id, data }` envelope. There are no path params or
query strings — filters go in the body.

- Base URL: `https://api.smtp2go.com/v3`
- Auth: `X-Smtp2go-Api-Key` header. The key is also injected into the request
  body as `api_key` for proxies that strip custom headers.
- `Smtp2goClient.post()` unwraps the `data` payload from the envelope and throws
  `Smtp2goApiError` (parsed from `data.error` / `data.error_code`) on failure.

## Structure

```
src/
├── api/
│   ├── client.ts        # POST transport: auth, retry/backoff, timeout, envelope unwrap
│   ├── index.ts         # Smtp2go class — one method per documented endpoint
│   └── client.test.ts   # fetch-mock tests
├── cli/index.ts         # Commander CLI
├── types/index.ts       # request/response types + Smtp2goApiError/parseApiError
├── utils/
│   ├── config.ts        # multi-profile config (~/.hasna/connectors/connect-smtp2go)
│   └── output.ts        # pretty/json/table formatting
└── index.ts             # library exports
```

## Adding endpoints

Only add endpoints documented at https://developers.smtp2go.com/. Add a method to
`Smtp2go` in `src/api/index.ts` (call `this.client.post('/path', body)`), a type
in `src/types/index.ts`, and a CLI subcommand in `src/cli/index.ts`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SMTP2GO_API_KEY` | API key (overrides profile) |
| `CONNECTOR_BASE_URL` | Override base URL (optional) |
