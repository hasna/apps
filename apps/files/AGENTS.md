# @hasna/files

This repo member is the OSS package `@hasna/files` — agent-first file
management via CLI + MCP + `files-serve` + generated SDK.

## Credential contract (binding, hasna/apps#1720)

- Hosted clients resolve their authority and credential through the ONE
  `@hasna/contracts` client resolver (macOS Keychain
  `hasna.credentials.files.api-key` / `.api-url`, account `HASNA_STATION` →
  `hostname -s` → `$USER`; disk `~/.hasna/files/config/credentials` 0600;
  `HASNA_FILES_API_KEY`; default URL `https://api.hasna.com/files`) — never a
  hand-rolled env read, never a DSN — applied FRESH PER REQUEST in the CLI,
  the MCP server and `./sdk` (`createFilesClientFromEnv`). Never hand the
  resolver a copied env: normalise blanks only, or pass
  `keychain: { enabled: true }` so the ambient gate survives the copy.
- Local data belongs in `~/.hasna/files/files.db` (resolver-resolved data
  root), reachable ONLY under the explicit local opt-in
  `HASNA_FILES_LOCAL=1` / `FILES_LOCAL=1`. No credential + no opt-in = fail
  closed, exit non-zero, no SQLite, no `*-local-fallback` event; a local run
  always says "LOCAL mode" on stderr. The retired `*_MODE` / `*_STORAGE_MODE`
  switches and the retired paths (`~/.hasna/fleet-env`, `~/.hasna/cloud`,
  `~/.config/hasna`, `$XDG_CONFIG_HOME`) are inputs nowhere.
- Maintain `src/store/client-types.ts` as the declaration-only leaf: the
  published `.d.ts` must not import `@hasna/contracts` (hasna/apps#1782).
  Crossing shapes are spelled locally and asserted against the real contracts
  types, both directions, in `src/store/client-types.test.ts`.
- `src/lib/local-opt-in.ts` is the one routing preamble: opt-in first (env
  only, no resolver call), then the resolver — CLI, MCP and SDK all ask it.
- SDK pinning (hasna/apps#1794): an explicit `baseUrl` with no `apiKey` never
  receives the ambient fleet key.

## Verify before done

```bash
bun run typecheck
bun test
bun run build
bun run contracts:conformance
```