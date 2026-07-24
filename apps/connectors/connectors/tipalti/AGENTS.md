# AGENTS.md

Guidance for AI agents working with the Tipalti connector.

## Overview

`connect-tipalti` wraps the Tipalti REST API (`https://api.tipalti.com/v1`) with Bearer authentication. Scope: payees, events, search, and raw requests.

## Commands

```bash
bun install && bun run typecheck && bun run build && bun test
connect-tipalti config set-key <key>
connect-tipalti payee list
connect-tipalti payee get <payeeId>
connect-tipalti payee create --email user@example.com --ref-code REF001
connect-tipalti events list
connect-tipalti search run --query acme --entity-type payee
connect-tipalti raw request --path /payees --method GET
```

## Environment

- `TIPALTI_API_KEY` — required for API calls
- `TIPALTI_BASE_URL` — optional override

Profiles live at `~/.hasna/connectors/tipalti/`.

## Security

- No hardcoded secrets
- `.env.example` has placeholders only
- No `browser-use` dependency
