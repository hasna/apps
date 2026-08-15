# AGENTS.md

Zoho Meeting connector (`@hasna/connect-zoho-meeting`). Uses Zoho-oauthtoken bearer auth, multi-profile config at `~/.hasna/connectors/zoho-meeting/`, and modular APIs under `src/api/`.

```bash
bun install
bun run dev
bun run typecheck
bun test
```

Do not add browser-use or internal references. Keep `.env.example` placeholder-only.
