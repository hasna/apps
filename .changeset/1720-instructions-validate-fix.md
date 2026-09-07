---
"@hasna/instructions": patch
---

Resolver validation fixes for hasna/apps#1720 (P2 polish).

- The importable module now ships INSIDE `@hasna/instructions` at the `./sdk`
  export (`import { createInstructionsV1ClientFromEnv } from "@hasna/instructions/sdk"`)
  as a self-contained bundle — node builtins only, the `@hasna/contracts`
  resolver inlined at build time, guarded by a two-sided bundle test. The
  never-published split `@hasna/instructions-sdk` scaffold (`sdk/`) is retired
  per the one-package-per-app rule, together with its `ConfigsClient`, which
  targeted the removed `/api/*` routes with a `localhost:3457` default.
- `hasna.contract.json` now describes the resolver adoption: the CLI and MCP
  surfaces are `api-key` (hosted by default, local store only via
  `HASNA_INSTRUCTIONS_LOCAL=1`), the client env names are
  `HASNA_INSTRUCTIONS_API_URL` / `HASNA_INSTRUCTIONS_API_KEY`, and the
  `typescript-sdk` surface is declared at `./sdk`.
- The fail-closed MCP startup probe is hermetic on Keychain-configured
  stations: it pins `HASNA_STATION` to a sentinel account and `HASNA_HOME` to a
  fresh temp dir so neither ambient tier can resolve, and asserts that nothing
  is created under the app home.
