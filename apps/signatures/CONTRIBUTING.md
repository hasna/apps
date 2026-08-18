# Contributing

Thanks for contributing to Hasna Signatures.

## Development

```bash
bun install
bun run typecheck
bun test
bun run build
```

Keep changes focused. Add tests for new signing behavior, Markdown rendering, provider
adapters, or persistence migrations.

## Pull Requests

- Explain the user-facing workflow affected by the change.
- Include verification commands and results.
- Do not commit generated local data from `.hasna/`, `.signatures/`, `.claude/`, or `dist/`
  unless a maintainer explicitly asks for release artifacts.
- Avoid adding hard dependencies for optional providers. Prefer adapter modules that fail
  with clear setup instructions.

## Security And Privacy

Do not include real documents, private signer details, API keys, tokens, or provider
credentials in tests or examples.
