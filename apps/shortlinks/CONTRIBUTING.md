# Contributing

Thanks for helping improve `@hasna/shortlinks`.

## Development

```bash
bun install
bun test
bun run typecheck
bun run build
```

Keep the package CLI-only. Redirect serving is allowed because it is required for functional shortlinks, but do not add a dashboard or web UI.

## Pull Requests

- Keep changes scoped.
- Add or update tests for behavior changes.
- Preserve JSON output for automation and agents.
- Do not commit secrets, tokens, local databases, or `.env` files.
- Use conventional commit messages such as `feat:`, `fix:`, and `docs:`.

## Package Naming

- GitHub repo: `hasna/shortlinks`
- npm package: `@hasna/shortlinks`
- Local folder: `shortlinks`
