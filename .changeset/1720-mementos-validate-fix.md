---
"@hasna/mementos": patch
---

hasna/apps#1720 validation fixes for the @hasna/contracts credential adoption —
every surface now fails closed the same way, and nothing hosted can materialise
the on-box store.

- `./sdk` **throws instead of degrading to the local serve.** With nothing
  resolvable — no argument, no env pointer, no Keychain item, no credentials
  file, no `HASNA_MEMENTOS_API_KEY` — `resolveMementosSdkTransport()`, the
  `apiUrl` getter and every request now throw the new `MementosConfigError`
  (`code: "MEMENTOS_STORE_CONFIG"`) naming the tiers consulted, before any
  request is built; the client no longer reads and writes
  `http://localhost:19428` with only a stderr notice. The on-box
  `mementos-serve` is reachable only through the deliberate opt-in
  (`HASNA_MEMENTOS_LOCAL=1` / `HASNA_MEMENTOS_DB_PATH`), which still announces
  itself once.
- `storage mode` **reports `unconfigured` and exits 1** (with the same
  refusal every data verb prints) when no credential resolves and no local
  opt-in is set, instead of exit 0 claiming `local-sqlite` / `default`. The
  `StoreBackend` report gains the `unconfigured` value.
- The legacy `~/.mementos` → data-root auto-migration in `getDbPath()` (both
  `src/db/database.ts` and `src/lib/config.ts`) runs **only under the explicit
  local opt-in**, so a hosted-mode diagnostic (`storage mode`, `status`,
  `doctor`) can never create `~/.hasna/mementos/mementos.db`.
- `getConfiguredApiEnv()` hands the resolver the same normalised inputs
  `getApiConfig()` does (blank aliases stripped, Keychain gate carried), and
  accepts the same resolve options.
- `mementos-serve` static bearer auth marks a matched request authenticated
  under the canonical `HASNA_MEMENTOS_API_KEY` name as well as the legacy
  alias (server-side only).
- The MCP's local-opt-in companion server logs under the app data root, never
  `/tmp/mementos.log`; the dead `~/.config/hasna` path kind is removed from the
  in-package paths resolver.
- The unpublished standalone `sdk/` scaffold (`@hasna/mementos-sdk`) is deleted
  — one package per app; `@hasna/mementos/sdk` is the only SDK — and the
  `model-config` test suite no longer renames or rewrites the operator's real
  `~/.hasna/mementos`.
