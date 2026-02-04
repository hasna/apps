# Contributing

Thanks for helping improve the connectors. Please follow these guidelines so we can keep publishing safe and consistent.

## NPM Auth (Optional)

If you need a scoped registry token (publish or private installs), copy an example file and set `NPM_TOKEN`:

```bash
# Repo root
cp .npmrc.example .npmrc

# Or per-connector
cp connectors/connect-<name>/.npmrc.example connectors/connect-<name>/.npmrc
```

- Do not commit `.npmrc` files with real tokens.
- Use environment variables in CI: `NPM_TOKEN` only.

## Safe Publish Flow

- Run the connector release script from that connector folder:
  - `bun run release` (or `release:patch`, `release:minor`, `release:major`)
- CI should inject `NPM_TOKEN` and create `.npmrc` at runtime if needed.

## Secrets

- Never commit `.env` files with real values.
- Keep credentials in your local environment only.
