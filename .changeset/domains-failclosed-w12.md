---
"@hasna/domains": patch
---

Keep `bun:sqlite` out of every client bundle, and stop double-prefixing the
retired-local-path refusal.

`domains` has no local client mode: `getStore()` only ever returns the hosted
`ApiStore`, and `HASNA_DOMAINS_DB_PATH` / `DOMAINS_DB_PATH` /
`HASNA_DOMAINS_DIR` / `DOMAINS_DIR` are refused outright. The CLI bundle still
carried sqlite anyway: `domains doctor` loaded the store module with a dynamic
`import()`, which materialises the whole module namespace, defeats per-export
tree-shaking, and dragged `LocalStore` → `db/database.ts` → `bun:sqlite` into
`dist/cli/index.js`.

- `LocalStore` moves out of `db/store.ts` into its own `db/local-store.ts`, so
  the sqlite modules are unreachable from `src/cli/index.ts`,
  `src/mcp/index.ts` and `src/sdk/index.ts` even through a namespace import. It
  stays exactly what it was — an explicit migration/unit-test fixture that
  `getStore()` never selects. It was never exported from the package root, so
  the public API is unchanged.
- `domains doctor` and `db/history.ts` now import statically instead of
  dynamically; behaviour is identical.
- New ratchet test `src/db/no-sqlite-in-client-bundles.test.ts` re-bundles each
  client entrypoint and fails if `bun:sqlite` reappears.
- The CLI's single-line error boundary no longer prints `domains: domains: …`
  when the retired-local-path refusal (which already carries the prefix) is the
  error.
- README / `docs/CLI.md` no longer advertise a local-SQLite opt-in that does
  not exist, and `domains route53 sync` no longer says it syncs "to local
  database" when it writes to the shared portfolio.

No command, flag, output format or exit code changes.
