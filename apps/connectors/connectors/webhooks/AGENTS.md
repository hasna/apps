# AGENTS.md

Outbound HTTP webhook utility connector.

## Build

```bash
bun install
bun run dev
bun run typecheck
```

## Notes

- No API key required; optional default URL and signing secret only
- Do not add browser-use or scraper dependencies
- Keep `list-incoming` as a stub that returns guidance only
