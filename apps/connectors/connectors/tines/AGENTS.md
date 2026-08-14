# AGENTS.md

TypeScript connector for the Tines SOAR API (`@hasna/connect-tines`).

## Commands

```bash
bun install
bun run dev
bun run typecheck
bun test
bun run build
```

## Auth

Bearer token via `TINES_API_KEY` + `TINES_TENANT_URL`. Profiles at `~/.hasna/connectors/connect-tines/`.

## Structure

```
src/api/     # client + resource modules
src/cli/     # connect-tines CLI
src/types/   # TypeScript types
src/utils/   # config + output
```

## Security

- No hardcoded secrets
- `.env.example` has placeholders only
- Tenant URL must use HTTPS
