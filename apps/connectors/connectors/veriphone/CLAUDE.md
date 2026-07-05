# CLAUDE.md

## Project Overview

connect-veriphone is a TypeScript CLI and library for the Veriphone phone validation and carrier lookup API.

- **Auth**: API key via `Authorization: Bearer <key>` (apikey/bearer)
- **Base URL**: `https://api.veriphone.io/v2`
- **Docs**: https://veriphone.io/docs

## Commands

```bash
bun install
bun run dev
bun run typecheck
bun test
bun run build
```

## CLI

```bash
connect-veriphone verify <phone> [--default-country <cc>] [--method get|post]
connect-veriphone config set-key <key>
connect-veriphone profile list|use|create|delete|show
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VERIPHONE_API_KEY` | API key (overrides profile) |
| `VERIPHONE_BASE_URL` | Override base URL |

## API Methods

- `verifyPhone({ phone, defaultCountry? })` — GET `/verify`
- `verifyPhonePost({ phone, defaultCountry? })` — POST `/verify`

## Config Storage

`~/.hasna/connectors/connect-veriphone/profiles/`
