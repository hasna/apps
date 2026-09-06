# Agent Notes — @hasna/messages

This repo directory is the OSS package `@hasna/messages`: direct agent-to-agent
DMs + DM-threads (CLI `messages`, MCP `messages-mcp`, HTTP API `messages-serve`,
SDK `./sdk`) over one domain implementation (`src/service.ts`).

## Credentials (binding)

There is ONE credential chain: `@hasna/contracts` 1.0.2 (build-time-only
dependency; `bun build --target bun` inlines it). The CLI, the MCP server and
`./sdk` all resolve through `src/sdk/resolve.ts` → `@hasna/contracts/client`,
per request, fresh. Do NOT reintroduce a private env chain — no
`~/.hasna/fleet-env`, `~/.hasna/cloud`, `~/.config/hasna`,
`~/.messages/config.json`, no `*_MODE` / `*_STORAGE_MODE` switches, no
DEPRECATED notices.

- Ladder: explicit arg → `HASNA_MESSAGES_API_KEY_OVERRIDE` / `HASNA_PROFILE` /
  `HASNA_MESSAGES_API_KEY_REF` → Keychain `hasna.credentials.messages.api-key`
  → `~/.hasna/messages/config/credentials` (0400/0600) → `HASNA_MESSAGES_API_KEY`.
- Authority follows the same ladder, defaulting to
  `https://api.hasna.com/messages` (client appends `/v1`).
- STRICT pair, fail loud: hosted with no resolvable credential = non-zero
  exit, no SQLite, no fallback event. A URL alone is a hard error.
- Local SQLite = ONLY `HASNA_MESSAGES_LOCAL=1` (alias `MESSAGES_LOCAL=1`) with
  nothing configured; every local run prints one "local mode" stderr line.
- `--url` pins the authority AND the credential (#1794): no ambient key is
  attached without a matching `--api-key`.
- Never hand `@hasna/contracts` a copied env (#1788): pass `process.env` by
  identity; normalise blanks without copying (`messagesResolverInputs` carries
  the Keychain gate as `keychain.enabled`).
- Published `.d.ts` must never import `@hasna/contracts` (#1782): crossing
  types are spelled in `src/sdk/client-types.ts` and `MessagesAuthQueryClient`
  in `src/server/auth.ts`; `src/sdk/client-types.test.ts` proves the spellings
  are the same types as the contracts declarations.

## Scope

messages owns direct agent-to-agent DMs + DM-threads. conversations owns
channels/announcements/channel-threads. Neither reads the other's store.

## Verification

Before reporting done:

```bash
bun install                 # pinned bun 1.3.14 (/home/hasna/bun-1.3.14/bin/bun)
bun run test                # domain + CLI + HTTP surface tests (hermetic)
bun run typecheck
bun run contract-check      # manifest conformance via @hasna/contracts
bun run build               # dist/ (sdk + index) and bin/ (CLI, MCP, serve)
```

After `bun run build`, `grep -r "@hasna/contracts" dist --include="*.d.ts"` must
find nothing.