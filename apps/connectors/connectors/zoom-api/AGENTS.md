# Zoom Api Connector

Use the Zoom Api REST API at `https://api.zoomapi.com/v1`. Do not add browser automation or internal Hasna/Alumia references.

Required checks:

```bash
bun run typecheck
bun run build
```

Security:

- Keep Zoom Api API keys out of source.
- Keep `.env.example` placeholder-only.
- Use `@hasna` package scope and `${NPM_TOKEN}` in `.npmrc`.
