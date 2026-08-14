# AGENTS.md

TextIt (RapidPro) connector — contacts, messages, flows via REST API v2.

## Commands

```bash
bun install
bun run typecheck
bun test
bun run dev contacts list
```

## Auth

- Type: API token (`Authorization: Token <token>`)
- Env: `TEXTIT_API_TOKEN`
- Config: `~/.hasna/connectors/connect-textit/profiles/`

## Security

- No hardcoded tokens
- `.env.example` uses placeholders only
- `@hasna` namespace
