---
"@hasna/economy": patch
---

Fail-closed / resolver validation fixes for the hosted-by-default client
(hasna/apps#1720, validation round 1).

- **MCP: no SQLite under the app home in hosted mode.** `economy-mcp` opened
  the agent-lifecycle registry (`agent-registry.db` plus its WAL/SHM sidecars)
  at startup — in hosted mode too, before any tool was called. The registry
  store is now resolved on first tool use, and a hosted client keeps it in
  memory for the life of the process; only the explicit `HASNA_ECONOMY_LOCAL=1`
  opt-in persists `agent-registry.db` beside the local store
  (`HASNA_AGENT_REGISTRY_DB_PATH` still names a file explicitly in either lane).
- **MCP: the fail-closed diagnostic is the first stderr line**
  (`MCP server error: Economy fails closed …`, naming the Keychain item, the
  credentials file and `HASNA_ECONOMY_API_KEY`) instead of Bun's code frame.
- **`economy transport` exits 1 when no credential resolves.** The report is
  still printed (`--json` included), so the diagnostic stays readable while a
  script can no longer take a refusal for a hosted transport.
- **`economy-otel` follows the storage seam.** With a resolved credential the
  sidecar forwards the request/session rows of every accepted payload to the
  shared API's `/v1/ingest` (the response gains `forwarded`; nothing is written
  under `~/.hasna/economy`); under `HASNA_ECONOMY_LOCAL=1` it writes the
  on-box store and announces local mode on stderr; with neither it fails
  closed before binding. `economy-otel` stays undeclared in
  `hasna.contract.json` because `-otel` is outside the contract kit's bin
  allowlist.
- **Hosted `economy sync` keeps its mtime cache as a JSON file under the cache
  root** (`HASNA_CACHE_HOME`, else `~/Library/Caches/Hasna/economy` on macOS /
  `~/.cache/hasna/economy` elsewhere; `HASNA_ECONOMY_INGEST_CACHE` overrides)
  instead of `~/.hasna/economy/ingest-cache.db`. An older cache file is simply
  not read — one re-read, absorbed by the server's idempotent upserts — and can
  be deleted.
- **Manifest:** the CLI and MCP surfaces declare `authMode: api-key`
  (credential via the `@hasna/contracts` chain) and the SDK surface
  `exportSubpath: ./sdk`.
- **No `-sdk` split package.** The unpublished in-tree `@hasna/economy-sdk`
  (`sdk/`) is removed: the SDK is the `./sdk` export of this one package — the
  Store abstraction, which takes no `baseUrl` and therefore never attaches an
  ambient fleet key to a caller-supplied one (hasna/apps#1794).
- Test hygiene: `src/mcp/http.test.ts` restores the local opt-in it pins, so
  the #1788 ambient-gate test passes in the full suite; new spawned-bin tests
  cover the MCP hosted / fail-closed arms, the three `economy-otel` lanes and
  the `economy transport` exit codes.
