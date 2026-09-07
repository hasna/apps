---
"@hasna/messages": patch
---

Resolver validation polish for hasna/apps#1720. The spawn-based tests
(`early-args.test.ts`, `cli.test.ts`) are now hermetic against the station's
macOS Keychain: the fake HOME is applied after the env copy (it used to be
overwritten by the inherited HOME) and `HASNA_STATION` is pinned to a sentinel
account, so the MCP and CLI fail-closed tests no longer read the real
`hasna.credentials.messages.api-key` item on a provisioned Mac. The vendored
path resolver keeps only the data kind messages uses (no config/state/cache
kinds, no retired dot-config location), the two data-root tests assert the
shape for the platform they run on, and `hasna.contract.json` declares
`authMode: "api-key"` for the CLI and MCP surfaces, which resolve a fleet key
through the `@hasna/contracts` chain. No runtime credential behaviour changes.
