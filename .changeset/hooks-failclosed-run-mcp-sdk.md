---
"@hasna/hooks": minor
---

Fail closed everywhere the client used to reach the on-box SQLite store silently (owner ruling 2026-09-07, hasna/apps#1720; supersedes #1888).

- `hooks run` (and the MCP run tools / bundled hook runtimes behind it) no longer writes `~/.hasna/hooks/hooks.db` on every hook event with no credential decision. The hook-event writer is gated: it writes only under the explicit local opt-in `HASNA_HOOKS_LOCAL=1` (alias `HOOKS_LOCAL=1`, answered from the env alone — no Keychain read on the per-event hot path); on the hosted route or with nothing configured it prints one `REMOTE_COMMAND_UNSUPPORTED` line and writes nothing. `hooks run` is no longer exempt from the transport gate: with nothing configured it exits 1 with one line naming the credential tiers and the opt-in.
- Hosted route is a route, not just admission: once a registry credential resolves (env pair, Keychain item, credentials file) the CLI installs a process-wide `refuseLocalStore()` in `getDb()`, so `hooks log *`, `hooks storage *` and every other local-only path refuse with `REMOTE_COMMAND_UNSUPPORTED` (naming the opt-in) instead of answering from an empty local file. Pins and trust keep working on the hosted route through `hooks.lock` alone; the `hooks` table is a local-mode mirror.
- New `hooks-mcp` bin (stdio). It decides its authority BEFORE the transport connects: nothing configured → exit 1 without answering `initialize`; hosted → local-only tools (`hooks_log_*`, `storage_*`, `send_feedback`) refuse; local opt-in → "hooks: LOCAL mode" on stderr. `hooks mcp --sse` and the Streamable HTTP mode make the same decision at startup.
- New `./sdk` export: `createHooksClient()` / `HooksClient` (catalog, lock, artifact, health) over the hosted registry, resolving the credential through the `@hasna/contracts` chain and throwing `REMOTE_API_*` when nothing resolves. The bundle imports node builtins only and never touches `bun:sqlite`.
- Carried from #1888: `hooks install|update <name>@<version>` under the local opt-in pins from the bundled registry (`installPinnedFromBundled`) instead of refusing; a bare `hooks` without a TTY refuses cleanly instead of an Ink raw-mode crash.
- Manifest: `bins` now `hooks`, `hooks-mcp`, `hooks-serve`; MCP surface `mcpBin: "hooks-mcp"`; SDK surface `exportSubpath: "./sdk"`.
