---
"@hasna/switcher": minor
---

Fail closed on every client surface (owner ruling 2026-09-07, hasna/apps#1720).

- With no Switcher API credential resolvable, `switcher` and `switcher-mcp` exit non-zero with one `remote_api_config_missing` line that names the sources consulted (Keychain item `hasna.credentials.switcher.api-key`, `~/.hasna/switcher/config/credentials`, `HASNA_SWITCHER_API_KEY`) and the opt-in; nothing is opened or created under `~/.hasna/switcher`. The CLI used to start an owned local API over `~/.hasna/switcher/switcher.db` whenever nothing was configured, and `switcher-mcp` answered `initialize` before it knew whether it had an authority.
- The on-box store is reachable only through the deliberate `HASNA_SWITCHER_LOCAL=1` opt-in (alias `SWITCHER_LOCAL=1`), answered from the environment before any Keychain or disk read; it prints one `switcher: LOCAL mode` line on stderr per process. A configured API URL, key, override, pointer or profile outranks the flag. `HASNA_SWITCHER_DATABASE_URL` / `HASNA_SWITCHER_SQLITE_PATH` now only choose the owned service's storage under that opt-in.
- `switcher-mcp` serves the same runtime as the CLI (hosted, or local under the opt-in) and decides before the stdio transport connects; `--version` and `--help` still answer without any resolution.
- Provider Keychain bindings report `keychain_item_missing` (security exit 44) separately from a locked or unreadable item (`keychain_unavailable`) and an unusable value (`keychain_item_invalid`); all three stay terminal, never a fallback. `@hasna/contracts` 1.0.2 has no reader for user-named Keychain items, so this remains an owned `security` invocation.
