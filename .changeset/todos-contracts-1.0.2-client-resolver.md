---
"@hasna/todos": patch
---

Resolve hosted credentials through the shared `@hasna/contracts` client chain by pinning the exact `@hasna/contracts` dependency at 1.0.2: the CLI, the MCP server and the `./sdk` client all call `resolveClientTransport`, which adds the macOS Keychain tier and no longer reads the retired `~/.hasna/fleet-env` and `~/.hasna/cloud` disk tiers. The shipped 0.16.0 tarball carries this pin; this record keeps the change visible to the changeset tooling for the next version bump.
