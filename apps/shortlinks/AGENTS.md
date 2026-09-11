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
  under the explicit environment opt-in (`HASNA_SHORTLINKS_LOCAL=1` /
  `SHORTLINKS_LOCAL=1`); selecting it prints `shortlinks: LOCAL mode — …` on
  stderr, once per process. `--db <path>` names the file for an opted-in run
  and is refused on its own — one door only. No credential + no opt-in = fail
  closed, exit non-zero.
- The local store is loaded through ONE gated dynamic import
  (`client-store.ts` → `local-store.ts`), and the build runs with `--splitting`
  so `bun:sqlite` lands in `dist/chunks/` — never in `dist/cli` or `dist/mcp`.
  Keep `grep -c 'bun:sqlite' dist/cli/*.js dist/mcp/*.js` at 0.
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