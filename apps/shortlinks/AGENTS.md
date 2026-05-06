# Agent Notes

This repo is the OSS package `@hasna/shortlinks`.

## Project Shape

- Keep it CLI-only. No dashboard or web UI.
- The redirect server command is part of the CLI package and is required for real shortlink operation.
- Use `shortlinks --json ...` for automation.
- Local data belongs in `~/.hasna/shortlinks/shortlinks.db`.
- Cloud sync service name is `shortlinks`.

## Naming

- GitHub repo: `hasna/shortlinks`
- npm package: `@hasna/shortlinks`
- Local folder: `open-shortlinks`

## Integrations

- Cloudflare helpers live under `shortlinks cloudflare`.
- Domain purchasing/checking goes through the `domains` CLI from `@hasna/domains`.
- Do not reference, install, or run removed `connect-*` packages.

## Verification

Before reporting done:

```bash
bun test
bun run typecheck
bun run build
```
