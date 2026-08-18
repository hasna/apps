# Agent Notes

This repo is the OSS package `@hasna/shortlinks`.

## Project Shape

- Keep it CLI-only. No dashboard or web UI.
- The redirect server command is part of the CLI package and is required for real shortlink operation.
- Use `shortlinks --json ...` for automation.
- Local data belongs in `~/.hasna/shortlinks/shortlinks.db`.
- Production database access uses app-owned `HASNA_SHORTLINKS_DATABASE_URL` / `SHORTLINKS_DATABASE_URL`.

## Naming

- GitHub repo: `hasna/shortlinks`
- npm package: `@hasna/shortlinks`
- Local folder: `shortlinks`

## Integrations

- Cloudflare helpers live under `shortlinks cloudflare`.
- PostgreSQL runtime helpers live under `shortlinks postgres`.
- Domain purchasing/checking goes through the `domains` CLI from `@hasna/domains`.
- Local host/proxy setup helpers live under `shortlinks local`.
- Do not reference, install, or run removed `connect-*` packages.

## Verification

Before reporting done:

```bash
bun test
bun run typecheck
bun run build
```
