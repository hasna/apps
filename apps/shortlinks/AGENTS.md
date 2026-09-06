# Agent Notes

This repo is the OSS package `@hasna/shortlinks`.

## Project Shape

- Keep it CLI-only. No dashboard or web UI.
- The redirect server command is part of the CLI package and is required for real shortlink operation.
- Use `shortlinks --json ...` for automation.
- Hosted clients resolve their authority and credential through the ONE
  `@hasna/contracts` client resolver (Keychain, `~/.hasna/shortlinks/config/credentials`,
  `HASNA_SHORTLINKS_API_KEY`, default fleet gateway URL) — never a hand-rolled
  env read, never a DSN, applied fresh per request in the CLI, MCP server, and
  `./sdk` (hasna/apps#1720).
- Local data belongs in `~/.hasna/shortlinks/shortlinks.db`, reachable ONLY
  under the explicit local opt-in (`HASNA_SHORTLINKS_LOCAL=1` / `SHORTLINKS_LOCAL=1`
  or `--db <path>`); selecting it prints "local" on stderr. No credential +
  no opt-in = fail closed, exit non-zero.
- Maintain `src/client-types.ts` as the declaration-only leaf: the published
  `.d.ts` must not import `@hasna/contracts` (hasna/apps#1782). Crossing shapes
  are spelled locally and asserted against the real contracts types in
  `src/client-types.test.ts`.
- Production database access uses app-owned `HASNA_SHORTLINKS_DATABASE_URL` / `SHORTLINKS_DATABASE_URL` (server only).

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