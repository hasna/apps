---
"@hasna/conversations": patch
---

Resolver validation fixes for the `@hasna/contracts` credential chain
adoption (hasna/apps#1720, round-2 review of #1864).

- `conversations-mcp` now FAILS CLOSED BEFORE SERVING. The store selection is
  decided once at startup, before either transport is connected: hosted with
  no resolvable credential exits 1 with the chain's refusal on stderr (the
  tiers consulted and the `HASNA_CONVERSATIONS_DB_PATH` opt-in — names, never
  values), answers no `initialize`, binds no port under `--http`, and opens or
  creates no SQLite file. Previously the server started, answered
  `initialize`, and returned an `isError` result per tool call — fail-loud per
  call, not fail-closed. The explicit local opt-in still starts the server and
  prints the LOCAL-mode notice once on stderr at startup; the CLI's
  `conversations mcp` subcommand raises the same refusal through the CLI error
  surface. Mirrors what `@hasna/mementos` received in #1868.
- `conversations events-drain` accepts `--json`: the fail-closed refusal now
  reaches the JSON error contract (`{"error", "code": "CONVERSATIONS_STORE_CONFIG"}`
  on stdout) instead of Commander's `unknown option '--json'`, and a successful
  drain under the local opt-in prints its report as a JSON object.
- `createConversationsClient` refreshes only the credential per request (one
  pass down the chain, one Keychain read) instead of re-deciding the authority
  the constructed client already holds.
